import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, events, projectSchedulers, runs, sql } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cancelRun } from "@handoff/engine/operations";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import { moveToReady, planIssue, setupPlan, type ShapingDeps } from "./shaping.ts";

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
  expect(await planEvents(run.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "Running", from: "Shaping" } }]);

  expect(await planIssue(deps, projectId, { issue: 12 })).toMatchObject({ number: 12, status: "Shaping" });
  expect(await statusOf(12)).toBe("Shaping");
});

test("plan_issue puts an issue whose active run has opened its pull request in In review", async () => {
  const run = await runBeforePlan([11]);
  await db.update(runs).set({ status: "waiting", prNumber: 88 }).where(eq(runs.id, run.id));
  await setupPlan(deps, projectId);
  expect(await planIssue(deps, projectId, { issue: 11 })).toMatchObject({ number: 11, status: "In review" });
  expect(statusOf(11)).toBe("In review");
  expect(await planEvents(run.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "In review", from: "Shaping" } }]);
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
  expect(await planEvents(running.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "Running", from: "Shaping" } }]);
  expect(await planEvents(reviewing.id)).toEqual([{ type: "plan.status", payload: { issue: 12, status: "In review", from: "Running" } }]);
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
  expect(await planEvents(run.id)).toEqual([{ type: "plan.status", payload: { issue: 11, status: "Running", from: "Shaping" } }]);
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

test("cancelling a run whose task plan_issue set to Running puts the task back in Shaping", async () => {
  const run = await runBeforePlan([11]);
  await setupPlan(deps, projectId);
  await planIssue(deps, projectId, { issue: 11 });
  await cancelRun(db, run.id, { projects: plan });
  expect(statusOf(11)).toBe("Shaping");
});

test("cancelling a run whose task setup_plan set to Running puts the task back in the Status it had", async () => {
  const run = await runBeforePlan([11, 12]);
  const roadmap = await plan.createProject("octo", { owner: "octo", name: "roadmap" }, "Roadmap");
  plan.plans.get("octo/roadmap")!.items = new Map([
    [11, { status: "Shaping" }],
    [12, { status: "Ready" }],
  ]);
  await setupPlan(deps, projectId, { use: roadmap.number });
  expect([statusOf(11), statusOf(12)]).toEqual(["Running", "Running"]);
  await cancelRun(db, run.id, { projects: plan });
  expect([statusOf(11), statusOf(12)]).toEqual(["Shaping", "Ready"]);
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
