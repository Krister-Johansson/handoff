import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { StartRefusal, startRun } from "./start-run.ts";
import { inspect, seedGraph } from "./testing/harness.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** A project with graph g and open issues 11 and 12 on a fake GitHub. */
async function project() {
  const github = new FakeGitHub();
  for (const number of [11, 12]) {
    github.issues.set(number, { number, title: `Issue ${number}`, url: `https://github.com/octo/sample/issues/${number}`, body: "", state: "open" });
  }
  const { project } = await seedGraph(db, linear);
  const start = (issues: number[], startedBy = "dashboard") => startRun(db, { projectId: project.id, graphName: "g", task: "", issues, startedBy }, { github });
  return { github, project, start };
}

test("startRun refuses an issue that an active run links and names the run", async () => {
  const { start } = await project();
  const first = await start([11]);
  await expect(start([12, 11])).rejects.toThrow(`#11 is taken by run ${first.id}, which is queued.`);
  expect((await db.select().from(runs)).map((r) => r.id)).toEqual([first.id]);
});

test("two concurrent starts on one issue create one run", async () => {
  const { start } = await project();
  const results = await Promise.allSettled([start([11]), start([11]), start([11])]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.flatMap((r) => (r.status === "rejected" ? [(r.reason as Error).message] : []))).toEqual([
    expect.stringContaining("#11 is taken by run"),
    expect.stringContaining("#11 is taken by run"),
  ]);
  expect(await db.select().from(runs)).toHaveLength(1);
});

test("a refusal of one issue is a StartRefusal, and a failure to start at all is not", async () => {
  const { github, project: seeded, start } = await project();
  await start([11]);
  github.issues.get(12)!.blockedBy = [11];

  await expect(start([11])).rejects.toBeInstanceOf(StartRefusal);
  await expect(start([12])).rejects.toThrow(new StartRefusal("#12 is blocked by #11 on GitHub. A run can start once they are closed."));
  const missing = startRun(db, { projectId: seeded.id, graphName: "gone", task: "", issues: [12] }, { github });
  await expect(missing).rejects.toThrow("no graph named gone");
  await expect(missing).rejects.not.toBeInstanceOf(StartRefusal);
});

test("startRun records startedBy on the run and in run.created", async () => {
  const { start } = await project();
  const run = await start([11], "scheduler");
  expect(run.startedBy).toBe("scheduler");
  const { events } = await inspect(db, run.id);
  expect(events.find((e) => e.type === "run.created")?.payload).toMatchObject({ issues: [11], startedBy: "scheduler" });
});

const repo = { owner: "octo", name: "sample" };

/** A project whose plan is the repository's GitHub Project; `task` adds a task in Ready to it. */
async function planned() {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "sample plan");
  const { project } = await seedGraph(db, linear);
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  const task = async (title: string) => {
    const created = (await plan.createIssue(repo, { project: number, title, body: "", labels: ["task"] })).number;
    plan.itemsOf(repo).get(created)!.status = "Ready";
    return created;
  };
  return { github, plan, number, project, task };
}

test("startRun with the Project items already read applies the Ready gate without reading the Project again", async () => {
  const { github, plan, number, project, task } = await planned();
  const first = await task("Ready on the Project, Shaping in the items read");
  const second = await task("Ready in the items read");
  // The caller's read is what counts, whatever the Project says now.
  const read = (await plan.listItems("octo", number, repo)).map((item) => (item.number === first ? { ...item, status: "Shaping" as const } : item));
  const listItems = vi.spyOn(plan, "listItems");
  const start = (issue: number) => startRun(db, { projectId: project.id, graphName: "g", task: "", issues: [issue], startedBy: "scheduler", items: read }, { github, projects: plan });

  await expect(start(first)).rejects.toThrow(`#${first} is in Shaping on the plan`);
  await expect(start(second)).resolves.toMatchObject({ status: "queued" });
  expect(listItems).not.toHaveBeenCalled();
  expect(await plan.getStatus(repo, number, second)).toBe("Running");
});

test("a second start on a planned task its run moved to Running names the run, not the status", async () => {
  const { github, plan, project, task } = await planned();
  const ready = await task("Ready to build");
  const start = () => startRun(db, { projectId: project.id, graphName: "g", task: "", issues: [ready], startedBy: "claude-code" }, { github, projects: plan });
  const first = await start();
  await expect(start()).rejects.toThrow(`#${ready} is taken by run ${first.id}, which is queued.`);
});

test("startRun records the size of its single linked task from the items it read", async () => {
  const { github, plan, number, project, task } = await planned();
  await plan.ensureEstimateFields("octo", number);
  const sized = await task("Sized M");
  plan.itemsOf(repo).get(sized)!.size = "M";
  const run = await startRun(db, { projectId: project.id, graphName: "g", task: "", issues: [sized], startedBy: "dashboard" }, { github, projects: plan });
  expect(run.size).toBe("M");
  // A later change of the task's size does not move the run.
  plan.itemsOf(repo).get(sized)!.size = "L";
  const [stored] = await db.select().from(runs).where(eq(runs.id, run.id));
  expect(stored?.size).toBe("M");
});

test("a run without a sized task, or with two tasks, records no size", async () => {
  const { github, plan, number, project, task } = await planned();
  await plan.ensureEstimateFields("octo", number);
  const unsized = await task("No size");
  const other = await task("Another Size option");
  plan.itemsOf(repo).get(other)!.size = "🐋 X-Large";
  const first = await task("Sized S");
  const second = await task("Sized L");
  plan.itemsOf(repo).get(first)!.size = "S";
  plan.itemsOf(repo).get(second)!.size = "L";
  const start = (issues: number[]) => startRun(db, { projectId: project.id, graphName: "g", task: "", issues, startedBy: "dashboard" }, { github, projects: plan });

  expect((await start([unsized])).size).toBeNull();
  expect((await start([other])).size).toBeNull();
  expect((await start([first, second])).size).toBeNull();
  expect((await startRun(db, { projectId: project.id, graphName: "g", task: "No issue at all" }, { github, projects: plan })).size).toBeNull();
});
