import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { asc, eq, planPins, projects, projectSchedulers } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { unpin, writeOrder } from "./flow-order.ts";
import { createProject, saveGraphVersion } from "./graphs.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/**
 * A Flow project with a plan on a fake GitHub; `item` adds an issue to the end of Project order. With
 * `organization`, the repository's owner octo is an organization that owns the Project.
 */
async function flowProject(opts: { organization?: boolean } = {}) {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  if (opts.organization) plan.owners.set("octo", "Organization");
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  const project = await createProject(db, { name: "todooverkill", repo: "octo/sample", defaultBranch: "main" });
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  await saveGraphVersion(db, { projectId: project.id, name: "linear", document: linear });
  const item = async (title: string, labels: string[], status?: string) => {
    const created = await plan.createIssue(repo, { project: number, title, body: "", labels });
    plan.itemsOf(repo).get(created.number)!.status = status;
    return created.number;
  };
  const ready = (title: string) => item(title, ["task"], "Ready");
  /** Every item of the Project in Project order. */
  const order = async () => (await plan.listItems("octo", number, repo)).map((i) => i.number);
  const pins = async () => db.select({ issue: planPins.issue, pinnedBy: planPins.pinnedBy, reason: planPins.reason }).from(planPins).orderBy(asc(planPins.issue));
  const moves = vi.spyOn(plan, "moveItems");
  const deps = { db, projects: plan };
  return { github, plan, project, item, ready, order, pins, moves, deps };
}

test("writeOrder moves the dragged task in Project order with one move and pins it", async () => {
  const { project, ready, order, pins, moves, deps } = await flowProject();
  const [a, b, c, d] = [await ready("Tree"), await ready("Board"), await ready("Flow"), await ready("Optimize")];

  await writeOrder(deps, project.id, { shown: [a, b, c, d], queue: [d, a, b, c], pin: [d], actor: "person" });

  expect(await order()).toEqual([d, a, b, c]);
  expect(moves).toHaveBeenCalledTimes(1);
  expect(moves.mock.calls[0]![2]).toEqual([{ itemId: `PVTI_${d}`, afterId: null }]);
  expect(await pins()).toEqual([{ issue: d, pinnedBy: "person", reason: "drop" }]);
});

test("writeOrder moves a task in an organization's Project order and pins it", async () => {
  const { plan, project, ready, order, pins, moves, deps } = await flowProject({ organization: true });
  const [a, b, c] = [await ready("Tree"), await ready("Board"), await ready("Flow")];

  await writeOrder(deps, project.id, { shown: [a, b, c], queue: [c, a, b], pin: [c], actor: "person" });

  expect(plan.plans.get("octo/sample")?.project.owner).toBe("Organization");
  expect(await order()).toEqual([c, a, b]);
  expect(moves).toHaveBeenCalledTimes(1);
  expect(moves.mock.calls[0]!.slice(0, 2)).toEqual(["octo", 1]);
  expect(await pins()).toEqual([{ issue: c, pinnedBy: "person", reason: "drop" }]);
});

test("epics, stories and closed items keep their places", async () => {
  const { github, project, item, ready, order, pins, moves, deps } = await flowProject();
  const epic = await item("Project management", ["epic"]);
  const a = await ready("Tree");
  const story = await item("Plan read model", ["story"]);
  const closed = await ready("Merged one");
  github.issues.get(closed)!.state = "closed";
  const b = await ready("Board");
  const c = await ready("Flow");
  const shaping = await item("Optimize", ["task"], "Shaping");
  // A pin left on a task that has since closed goes on the next order write.
  await db.insert(planPins).values({ projectId: project.id, issue: closed, pinnedBy: "person", reason: "drop" });

  await writeOrder(deps, project.id, { shown: [a, b, c, shaping], queue: [c, a, b, shaping], pin: [c], actor: "person" });

  // The queue's tasks fill the places its tasks held: places 2, 5, 6 and 7.
  expect(await order()).toEqual([epic, c, story, closed, a, b, shaping]);
  expect(moves.mock.calls[0]![2]).toHaveLength(2);
  expect(await pins()).toEqual([{ issue: c, pinnedBy: "person", reason: "drop" }]);
});

test("a queue that changed on GitHub is refused and nothing is written", async () => {
  const { plan, project, ready, order, pins, moves, deps } = await flowProject();
  const [a, b, c] = [await ready("Tree"), await ready("Board"), await ready("Flow")];
  // Someone moved #c to the top on GitHub after the page read the order.
  await plan.moveItems("octo", 1, [{ itemId: `PVTI_${c}`, afterId: null }]);
  moves.mockClear();

  await expect(writeOrder(deps, project.id, { shown: [a, b, c], queue: [b, a, c], pin: [b], actor: "person" })).rejects.toThrow(
    "The order changed on GitHub since the page loaded. The Flow now shows the new order.",
  );
  expect(moves).not.toHaveBeenCalled();
  expect(await order()).toEqual([c, a, b]);
  expect(await pins()).toEqual([]);
});

test("Undo writes the previous order and removes the pin", async () => {
  const { project, ready, order, pins, deps } = await flowProject();
  const [a, b, c] = [await ready("Tree"), await ready("Board"), await ready("Flow")];
  await db.insert(planPins).values({ projectId: project.id, issue: b, pinnedBy: "person", reason: "keep_here" });
  await writeOrder(deps, project.id, { shown: [a, b, c], queue: [c, a, b], pin: [c], actor: "person" });

  await writeOrder(deps, project.id, { shown: [c, a, b], queue: [a, b, c], unpin: [c], actor: "person" });

  expect(await order()).toEqual([a, b, c]);
  expect(await pins()).toEqual([{ issue: b, pinnedBy: "person", reason: "keep_here" }]);
});

test("a refused GitHub write changes no pin", async () => {
  const { project, ready, order, pins, moves, deps } = await flowProject();
  const [a, b, c] = [await ready("Tree"), await ready("Board"), await ready("Flow")];
  await db.insert(planPins).values({ projectId: project.id, issue: a, pinnedBy: "person", reason: "drop" });
  moves.mockRejectedValueOnce(new Error("GitHub moved 0 of 1 items in Project order, then refused: something went wrong"));

  await expect(writeOrder(deps, project.id, { shown: [a, b, c], queue: [c, a, b], pin: [c], unpin: [a], actor: "person" })).rejects.toThrow("GitHub moved 0 of 1 items");
  expect(await order()).toEqual([a, b, c]);
  expect(await pins()).toEqual([{ issue: a, pinnedBy: "person", reason: "drop" }]);
});

test("Priority order is refused with the sentence", async () => {
  const { project, ready, order, pins, moves, deps } = await flowProject();
  const [a, b] = [await ready("Tree"), await ready("Board")];
  await db.insert(projectSchedulers).values({ projectId: project.id, enabled: true, order: "priority", graphName: "linear" });

  await expect(writeOrder(deps, project.id, { shown: [a, b], queue: [b, a], pin: [b], actor: "person" })).rejects.toThrow(
    "The scheduler starts tasks by Priority, so the order of the tasks does not decide what starts next. Switch the scheduler to Project order to plan by order.",
  );
  expect(moves).not.toHaveBeenCalled();
  expect(await order()).toEqual([a, b]);
  expect(await pins()).toEqual([]);
});

test("a Timeline project refuses an order write with the sentence", async () => {
  const { project, ready, order, moves, deps } = await flowProject();
  const [a, b] = [await ready("Tree"), await ready("Board")];
  await db.update(projects).set({ planMode: "timeline" }).where(eq(projects.id, project.id));

  await expect(writeOrder(deps, project.id, { shown: [a, b], queue: [b, a], actor: "person" })).rejects.toThrow(
    "todooverkill plans in Timeline mode: order work with dates through arrange_plan and schedule.",
  );
  expect(moves).not.toHaveBeenCalled();
  expect(await order()).toEqual([a, b]);
});

test("a new order must hold the tasks shown, and only tasks in it can be pinned", async () => {
  const { project, ready, order, moves, deps } = await flowProject();
  const [a, b, c] = [await ready("Tree"), await ready("Board"), await ready("Flow")];

  await expect(writeOrder(deps, project.id, { shown: [a, b, c], queue: [b, a], actor: "person" })).rejects.toThrow("The new order must hold the same tasks as the order shown.");
  await expect(writeOrder(deps, project.id, { shown: [a, b, c], queue: [b, a, c], pin: [99], actor: "person" })).rejects.toThrow("#99 is not in the order, so it cannot be pinned.");
  expect(moves).not.toHaveBeenCalled();
  expect(await order()).toEqual([a, b, c]);
});

test("unpin removes a task's pin and writes nothing to GitHub", async () => {
  const { project, ready, pins, moves } = await flowProject();
  const [a, b] = [await ready("Tree"), await ready("Board")];
  await db.insert(planPins).values([a, b].map((issue) => ({ projectId: project.id, issue, pinnedBy: "person", reason: "drop" as const })));

  await unpin(db, project.id, a);

  expect(await pins()).toEqual([{ issue: b, pinnedBy: "person", reason: "drop" }]);
  expect(moves).not.toHaveBeenCalled();
});
