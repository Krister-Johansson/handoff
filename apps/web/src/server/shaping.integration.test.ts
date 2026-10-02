import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, events, projectSchedulers, runs, sql } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import { addEstimateFields, moveToReady, planIssue, setSize, setupPlan, type ShapingDeps } from "./shaping.ts";

const db = createTestDb();
const repo = { owner: "octo", name: "sample" };
let github: FakeGitHub;
let plan: FakeProjects;
let deps: ShapingDeps;
let projectId: string;

beforeEach(async () => {
  await truncateAll(db);
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  projectId = project.id;
  await saveGraphVersion(db, { projectId, name: "linear", document: linear });
  github = new FakeGitHub();
  for (const number of [11, 12]) {
    github.issues.set(number, { number, title: `Issue ${number}`, url: `https://github.com/octo/sample/issues/${number}`, body: `Body ${number}`, state: "open" });
  }
  plan = new FakeProjects(github);
  deps = { db, github, projects: plan };
});
afterAll(() => db.$client.end());

/** A run started on issues before the project had a plan, as run 64fde8ef was. */
const runBeforePlan = (issues: number[]) => startRunFromGraph(db, { projectId, graphName: "linear", task: "", issues }, github);

const statusOf = (issue: number) => plan.itemsOf(repo).get(issue)?.status;
const planEvents = async (runId: string) =>
  (await db.select({ type: events.type, payload: events.payload }).from(events).where(eq(events.runId, runId))).filter((e) => e.type.startsWith("plan."));

test("plan_issue puts an issue whose run is active in Running and records it on the run; one without a run stays in Shaping", async () => {
  const run = await runBeforePlan([11]);
  await setupPlan(deps, projectId);
  expect(await planIssue(deps, projectId, { issue: 11 })).toMatchObject({ number: 11, status: "Running" });
  expect(await statusOf(11)).toBe("Running");
  expect(await planEvents(run.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "Running" } }]);

  expect(await planIssue(deps, projectId, { issue: 12 })).toMatchObject({ number: 12, status: "Shaping" });
  expect(await statusOf(12)).toBe("Shaping");
});

test("plan_issue puts an issue whose active run has opened its pull request in In review", async () => {
  const run = await runBeforePlan([11]);
  await db.update(runs).set({ status: "waiting", prNumber: 88 }).where(eq(runs.id, run.id));
  await setupPlan(deps, projectId);
  expect(await planIssue(deps, projectId, { issue: 11 })).toMatchObject({ number: 11, status: "In review" });
  expect(statusOf(11)).toBe("In review");
  expect(await planEvents(run.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "In review" } }]);
});

test("setup_plan taking over a Project sets the items active runs work on to the runs' Status and leaves the others", async () => {
  const running = await runBeforePlan([11]);
  const reviewing = await runBeforePlan([12]);
  await db.update(runs).set({ prNumber: 88 }).where(eq(runs.id, reviewing.id));
  github.issues.set(13, { number: 13, title: "Issue 13", url: "https://github.com/octo/sample/issues/13", body: "Body 13", state: "open" });
  const roadmap = await plan.createProject("octo", { owner: "octo", name: "roadmap" }, "Roadmap");
  plan.plans.get("octo/roadmap")!.items = new Map([
    [11, { status: "Shaping" }],
    [12, { status: "Running" }],
    [13, { status: "Shaping" }],
  ]);

  const adopted = await setupPlan(deps, projectId, { use: roadmap.number });
  expect(adopted).toMatchObject({
    statuses_from_runs: [
      { issue: 11, status: "Running", run: running.id },
      { issue: 12, status: "In review", run: reviewing.id },
    ],
  });
  expect([statusOf(11), statusOf(12), statusOf(13)]).toEqual(["Running", "In review", "Shaping"]);
  expect(await planEvents(running.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "Running" } }]);
  expect(await planEvents(reviewing.id)).toEqual([{ type: "plan.status", payload: { issue: 12, status: "In review" } }]);
});

test("setup_plan again on a plan whose item landed in Shaping during its run sets it to Running", async () => {
  const run = await runBeforePlan([11]);
  const created = await setupPlan(deps, projectId);
  expect(created).toMatchObject({ created: true, statuses_from_runs: [] });
  // An issue added in Shaping while its run was active, as before the fix.
  plan.itemsOf(repo).set(11, { status: "Shaping" });
  plan.itemsOf(repo).set(12, { status: "Shaping" });

  expect(await setupPlan(deps, projectId)).toMatchObject({ created: false, statuses_from_runs: [{ issue: 11, status: "Running", run: run.id }] });
  expect([statusOf(11), statusOf(12)]).toEqual(["Running", "Shaping"]);
  expect(await planEvents(run.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "Running" } }]);
  // Once the Status agrees with the run, setup_plan writes nothing more.
  expect(await setupPlan(deps, projectId)).toMatchObject({ statuses_from_runs: [] });
  expect(await planEvents(run.id)).toHaveLength(1);
});

test("plan_issue records a skipped write on the run and reports Shaping when the Project lacks the run's Status", async () => {
  const run = await runBeforePlan([11]);
  await setupPlan(deps, projectId);
  plan.plans.get("octo/sample")!.project.statusOptions.Running = undefined;
  expect(await planIssue(deps, projectId, { issue: 11 })).toMatchObject({ number: 11, status: "Shaping" });
  expect(statusOf(11)).toBe("Shaping");
  expect(await planEvents(run.id)).toEqual([{ type: "plan.skipped", payload: { issue: 11, status: "Running", reason: "no-option" } }]);
});

test("plan_issue leaves an issue whose run ended in Shaping and writes nothing on that run", async () => {
  const run = await runBeforePlan([11]);
  await db.update(runs).set({ status: "succeeded", prNumber: 88 }).where(eq(runs.id, run.id));
  await setupPlan(deps, projectId);
  expect(await planIssue(deps, projectId, { issue: 11 })).toMatchObject({ number: 11, status: "Shaping" });
  expect(statusOf(11)).toBe("Shaping");
  expect(await planEvents(run.id)).toEqual([]);
});

test("moving tasks to Ready nudges the project's scheduler", async () => {
  await setupPlan(deps, projectId);
  await planIssue(deps, projectId, { issue: 11 });
  await db
    .insert(projectSchedulers)
    .values({ projectId, enabled: true, graphName: "linear", lastCheckAt: sql`now() - interval '30 seconds'`, nextCheckAt: sql`now() + interval '30 seconds'` });

  await moveToReady(deps, projectId, [11]);

  const [row] = await db.select({ due: sql<boolean>`${projectSchedulers.nextCheckAt} <= now()` }).from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId));
  expect(row!.due).toBe(true);
});

/** A story #20 with tasks #21 and #22 that both start on Oct 4, #22 blocked by #21, in a plan with Size and Estimate. */
async function sizedPlan() {
  await setupPlan(deps, projectId);
  const issue = (number: number, labels: string[], blockedBy: number[] = []) =>
    github.issues.set(number, { number, title: `Issue ${number}`, url: `https://github.com/octo/sample/issues/${number}`, body: "", state: "open", labels, blockedBy });
  issue(20, ["story"]);
  issue(21, ["task"]);
  issue(22, ["task"], [21]);
  plan.parents.set(21, 20);
  plan.parents.set(22, 20);
  const items = plan.itemsOf(repo);
  items.set(20, { status: "Shaping" });
  items.set(21, { status: "Shaping", start: "2026-10-04", target: "2026-10-04", size: "L" });
  items.set(22, { status: "Shaping", start: "2026-10-04", target: "2026-10-04" });
  return items;
}

test("setSize writes Size and moves the Target of a task with a Start", async () => {
  const items = await sizedPlan();

  // #22 starts after #21's 2 hours on Oct 4: 2 and 9 hours at 6 a day end on Oct 5.
  expect(await setSize(deps, projectId, { issue: 22, estimate: 9 })).toEqual({
    issue: 22,
    estimate: { from: null, to: 9 },
    target: { from: "2026-10-04", to: "2026-10-05" },
  });
  expect(items.get(22)).toMatchObject({ estimate: 9, target: "2026-10-05", start: "2026-10-04" });

  // A size keeps the estimate, so the Target stays.
  expect(await setSize(deps, projectId, { issue: 22, size: "S" })).toEqual({ issue: 22, size: { from: null, to: "S" } });
  expect(items.get(22)).toMatchObject({ size: "S", estimate: 9, target: "2026-10-05" });

  // Back to the forecast: S's default of 30 minutes after #21's 2 hours ends on Oct 4. 0 is no estimate.
  expect(await setSize(deps, projectId, { issue: 22, estimate: 0 })).toEqual({
    issue: 22,
    estimate: { from: 9, to: null },
    target: { from: "2026-10-05", to: "2026-10-04" },
  });
  expect(items.get(22)?.estimate).toBeUndefined();

  // A task without a Start keeps its dates.
  items.set(23, { status: "Shaping" });
  github.issues.set(23, { number: 23, title: "Issue 23", url: "https://github.com/octo/sample/issues/23", body: "", state: "open", labels: ["task"] });
  expect(await setSize(deps, projectId, { issue: 23, size: "M" })).toEqual({ issue: 23, size: { from: null, to: "M" } });
  expect(items.get(23)).toEqual({ status: "Shaping", size: "M" });

  await expect(setSize(deps, projectId, { issue: 20, size: "M" })).rejects.toThrow("#20 is a story. Only tasks have a size; stories and epics sum their tasks.");
  await expect(setSize(deps, projectId, { issue: 99, size: "M" })).rejects.toThrow("#99 is not in the plan of sandbox. Add it with plan_issue first.");
  await expect(setSize(deps, projectId, { issue: 22, estimate: -1 })).rejects.toThrow("An estimate is hours from 0 to 1000.");

  plan.plans.get("octo/sample")!.project.estimateFields = undefined;
  await expect(setSize(deps, projectId, { issue: 22, size: "M" })).rejects.toThrow(
    "GitHub Project #1 has no Size and no Estimate field. Add them with Add the fields on the Plan timeline, or run setup_plan.",
  );
  expect(items.get(22)?.size).toBe("S");
});

test("setup_plan creates Size and Estimate on a new Project and adds them when adopting", async () => {
  const created = await setupPlan(deps, projectId);
  expect(created).toMatchObject({ created: true, added_estimate_fields: ["Size", "Estimate"] });
  expect(plan.plans.get("octo/sample")!.project.estimateFields).toEqual({
    size: { id: "field-size", options: { S: "opt-size-s", M: "opt-size-m", L: "opt-size-l" } },
    estimate: "field-estimate",
  });
  expect(await setupPlan(deps, projectId)).toMatchObject({ created: false, added_estimate_fields: [] });

  // Adopting a Project whose Size lacks S, M and L adds them; a Project without Estimate gets it.
  await truncateAll(db);
  projectId = (await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" })).id;
  const roadmap = await plan.createProject("octo", { owner: "octo", name: "roadmap" }, "Roadmap");
  plan.plans.get("octo/roadmap")!.project.estimateFields = { size: { id: "field-old-size", options: { S: undefined, M: undefined, L: undefined } }, estimate: undefined };
  const adopted = await setupPlan(deps, projectId, { use: roadmap.number });
  expect(adopted).toMatchObject({ created: false, added_estimate_fields: ["Size", "Estimate"] });
  expect((await plan.getProject("octo", roadmap.number))?.estimateFields).toEqual({
    size: { id: "field-old-size", options: { S: "opt-size-s", M: "opt-size-m", L: "opt-size-l" } },
    estimate: "field-estimate",
  });

  // The timeline banner's Add the fields does the same on a plan that has none.
  plan.plans.get("octo/sample")!.project.estimateFields = undefined;
  await expect(addEstimateFields(deps, projectId)).resolves.toEqual({ estimate_fields: expect.objectContaining({ estimate: "field-estimate" }) });
});
