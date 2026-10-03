import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import { loadPlan } from "./plan.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/** A handoff project whose repository has a GitHub Project, stored as its plan. */
async function planned() {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const issue = async (title: string, labels: string[], parent?: number) =>
    (await plan.createIssue(repo, { project: number, title, body: `${title} body`, labels, parent })).number;
  const status = (issue: number, value: string | undefined) => {
    plan.itemsOf(repo).get(issue)!.status = value;
  };
  return { github, plan, project, number, issue, status };
}

test("loadPlan nests stories under their epic and tasks under their story, with each task's status, blockers and latest run", async () => {
  const { github, plan, project, issue, status } = await planned();
  const epic = await issue("Project management", ["epic"]);
  const story = await issue("Plan read model", ["story"], epic);
  const migration = await issue("Add the column", ["task"], story);
  const gate = await issue("The Ready gate", ["task"], story);
  github.issues.get(gate)!.blockedBy = [migration];
  status(migration, "Ready");
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [migration] }, github);
  await db.update(runs).set({ status: "waiting", prNumber: 88 }).where(eq(runs.id, run.id));

  const view = await loadPlan(db, github, plan, project.id);
  if ("error" in view) throw new Error(view.error);
  expect(view.epics.map((e) => [e.number, e.title])).toEqual([[epic, "Project management"]]);
  expect(view.epics[0]!.stories.map((s) => [s.number, s.title])).toEqual([[story, "Plan read model"]]);
  expect(view.epics[0]!.stories[0]!.tasks.map((t) => [t.number, t.status, t.blockedBy, t.run])).toEqual([
    [migration, "Ready", [], { id: run.id, status: "waiting", prNumber: 88 }],
    [gate, "Shaping", [migration], null],
  ]);
});

test("progress counts a story's tasks by status and marks closed tasks done whatever their status", async () => {
  const { github, plan, project, issue, status } = await planned();
  const epic = await issue("Project management", ["epic"]);
  const story = await issue("Plan read model", ["story"], epic);
  const other = await issue("Status writes", ["story"], epic);
  await issue("Shaped later", ["task"], story);
  const ready = await issue("Ready one", ["task"], story);
  const running = await issue("Running one", ["task"], story);
  const merged = await issue("Merged one", ["task"], story);
  const done = await issue("Done one", ["task"], other);
  status(ready, "Ready");
  status(running, "Running");
  status(merged, "In review");
  github.issues.get(merged)!.state = "closed";
  status(done, "Done");

  const view = await loadPlan(db, github, plan, project.id);
  if ("error" in view) throw new Error(view.error);
  const [first, second] = view.epics[0]!.stories;
  expect(first!.progress).toEqual({
    done: 1,
    total: 4,
    byStatus: { Shaping: 1, Ready: 1, Running: 1, "In review": 0, Done: 1, Other: 0 },
    subIssues: { total: 4, completed: 1 },
  });
  expect(first!.tasks.find((t) => t.number === merged)!.status).toBe("Done");
  expect(second!.progress).toMatchObject({ done: 1, total: 1 });
  expect(view.epics[0]!.progress).toMatchObject({ done: 2, total: 5, byStatus: { Shaping: 1, Ready: 1, Running: 1, "In review": 0, Done: 2, Other: 0 } });
});

test("a task whose parent is an epic hangs under the epic, and an issue whose parent is outside the plan is listed as unparented", async () => {
  const { github, plan, project, issue } = await planned();
  const epic = await issue("Project management", ["epic"]);
  const direct = await issue("Write the ADR", ["task"], epic);
  github.issues.set(90, { number: 90, title: "Outside", url: "https://github.com/octo/sample/issues/90", body: "", state: "open" });
  const stray = await issue("Stray task", ["task"], 90);

  const view = await loadPlan(db, github, plan, project.id);
  if ("error" in view) throw new Error(view.error);
  expect(view.epics.map((e) => e.number)).toEqual([epic]);
  expect(view.epics[0]!.tasks.map((t) => [t.number, t.status])).toEqual([[direct, "Shaping"]]);
  expect(view.epics[0]!.progress).toMatchObject({ done: 0, total: 1 });
  expect(view.unparented.map((i) => [i.number, i.parent])).toEqual([[stray, 90]]);
});

test("open issues outside the Project are listed as unplanned", async () => {
  const { github, plan, project, issue } = await planned();
  await issue("Project management", ["epic"]);
  github.issues.set(90, { number: 90, title: "Fix the crash", url: "https://github.com/octo/sample/issues/90", body: "", state: "open", updatedAt: "2026-10-01T10:00:00Z" });
  github.issues.set(91, { number: 91, title: "Old and done", url: "https://github.com/octo/sample/issues/91", body: "", state: "closed" });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [90] }, github);

  const view = await loadPlan(db, github, plan, project.id);
  if ("error" in view) throw new Error(view.error);
  expect(view.unplanned.map((i) => [i.number, i.title, i.run?.id ?? null])).toEqual([[90, "Fix the crash", run.id]]);
});

test("a task in an unknown status column is listed under other", async () => {
  const { github, plan, project, issue, status } = await planned();
  const epic = await issue("Project management", ["epic"]);
  const story = await issue("Plan read model", ["story"], epic);
  const parked = await issue("Parked task", ["task"], story);
  const ready = await issue("Ready task", ["task"], story);
  const closed = await issue("Closed task", ["task"], story);
  status(parked, "Blocked");
  status(ready, "Ready");
  github.issues.get(closed)!.state = "closed";

  const view = await loadPlan(db, github, plan, project.id);
  if ("error" in view) throw new Error(view.error);
  const columns = Object.fromEntries(Object.entries(view.board).map(([column, tasks]) => [column, tasks.map((t) => t.number)]));
  expect(columns).toEqual({ Shaping: [], Ready: [ready], Running: [], "In review": [], Done: [closed], Other: [parked] });
  expect(view.epics[0]!.stories[0]!.progress.byStatus.Other).toBe(1);
});

test("loadPlan joins each task's runs into actual strips and marks late tasks from live blockers", async () => {
  const { github, plan, project, number, issue } = await planned();
  await db.update(projects).set({ planMode: "timeline" }).where(eq(projects.id, project.id));
  const epic = await issue("Project management", ["epic"]);
  const story = await issue("Dates", ["story"], epic);
  const migration = await issue("Add the column", ["task"], story);
  const gate = await issue("Read the column", ["task"], story);
  github.issues.get(gate)!.blockedBy = [migration];
  expect(await plan.setDates(repo, number, migration, { start: "2026-10-05", target: "2026-10-07" })).toBe("set");
  expect(await plan.setDates(repo, number, gate, { start: "2026-10-08", target: "2026-10-12" })).toBe("set");
  const start = (task: number) => startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [task] }, github);
  const first = await start(migration);
  await db
    .update(runs)
    .set({ status: "cancelled", startedAt: new Date("2026-10-05T09:00:00Z"), finishedAt: new Date("2026-10-05T10:00:00Z") })
    .where(eq(runs.id, first.id));
  const second = await start(migration);
  await db.update(runs).set({ status: "running", startedAt: new Date("2026-10-09T08:00:00Z") }).where(eq(runs.id, second.id));

  const now = new Date(2026, 9, 10, 12);
  const view = await loadPlan(db, github, plan, project.id, { now });
  if ("error" in view) throw new Error(view.error);
  const timeline = view.timeline!;
  const of = (n: number) => timeline.items.find((i) => i.number === n)!;
  expect(of(migration).actual).toEqual([
    { runId: second.id, status: "running", start: "2026-10-09T08:00:00.000Z", end: now.toISOString(), active: true },
    { runId: first.id, status: "cancelled", start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T10:00:00.000Z", active: false },
  ]);
  expect(of(migration)).toMatchObject({ planned: { start: "2026-10-05", end: "2026-10-07" }, overdueDays: 3 });
  expect(of(gate)).toMatchObject({ late: true, waitingOn: [migration] });
  expect(of(story).derived).toEqual({ start: "2026-10-05", end: "2026-10-12" });
  expect(timeline.arrows).toEqual([{ from: migration, to: gate, late: true }]);

  // The blocker closes on GitHub: the next read no longer counts the task late.
  github.issues.get(migration)!.state = "closed";
  const later = await loadPlan(db, github, plan, project.id, { now });
  if ("error" in later) throw new Error(later.error);
  expect(later.timeline!.items.find((i) => i.number === gate)).toMatchObject({ late: false, waitingOn: [] });
});

/** A succeeded run on one task whose planner proposed a size from a plan of `steps` steps and `paths` owned paths. */
async function proposed(projectId: string, github: FakeGitHub, task: number, size: "S" | "M" | "L", steps = 2, paths = 3) {
  const run = await startRunFromGraph(db, { projectId, graphName: "g", task: "", issues: [task] }, github);
  const plan = { plan: "p", steps: Array.from({ length: steps }, (_, i) => `step ${i}`), ownedPaths: Array.from({ length: paths }, (_, i) => `src/${i}.ts`), size };
  await db
    .update(runs)
    .set({ status: "succeeded", state: { ...run.state, plan } })
    .where(eq(runs.id, run.id));
  return run;
}

test("loadPlan gives each task its size, estimate, proposal and duration, and the project its forecasts and capacity", async () => {
  const { github, plan, project, number, issue, status } = await planned();
  await plan.ensureEstimateFields("octo", number);
  await db.update(projects).set({ planHoursPerDay: 8 }).where(eq(projects.id, project.id));
  const epic = await issue("Estimates", ["epic"]);
  const story = await issue("Forecasts", ["story"], epic);
  const estimated = await issue("Estimated", ["task"], story);
  const sized = await issue("Sized", ["task"], story);
  const proposal = await issue("Proposed", ["task"], story);
  const bare = await issue("Bare", ["task"], story);
  const item = (n: number) => plan.itemsOf(repo).get(n)!;
  Object.assign(item(estimated), { size: "M", estimate: 3 });
  item(sized).size = "L";
  status(proposal, "Ready");
  const run = await proposed(project.id, github, proposal, "S", 6, 4);

  const view = await loadPlan(db, github, plan, project.id);
  if ("error" in view) throw new Error(view.error);
  expect(view.capacity).toBe(8);
  expect(view.forecasts).toMatchObject({ S: { source: "default", minutes: 30 }, M: { source: "default", minutes: 60 }, L: { source: "default", minutes: 120 } });
  const tasks = view.epics[0]!.stories[0]!.tasks;
  expect(tasks.map((t) => [t.number, t.size, t.estimate, t.proposal, t.duration])).toEqual([
    [estimated, "M", 3, null, { hours: 3, source: "estimate" }],
    [sized, "L", undefined, null, { hours: 2, source: "default" }],
    [proposal, undefined, undefined, { size: "S", runId: run.id, steps: 6, paths: 4 }, { hours: 0.5, source: "proposal" }],
    [bare, undefined, undefined, null, null],
  ]);
  expect(view.board.Shaping.find((t) => t.number === sized)!.duration).toEqual({ hours: 2, source: "default" });
});

test("a task with a Size ignores a planner's proposal", async () => {
  const { github, plan, project, number, issue, status } = await planned();
  await plan.ensureEstimateFields("octo", number);
  const story = await issue("Forecasts", ["story"], await issue("Estimates", ["epic"]));
  const sized = await issue("Sized after its run", ["task"], story);
  status(sized, "Ready");
  const run = await proposed(project.id, github, sized, "L");
  plan.itemsOf(repo).get(sized)!.size = "S";

  const view = await loadPlan(db, github, plan, project.id);
  if ("error" in view) throw new Error(view.error);
  const task = view.epics[0]!.stories[0]!.tasks[0]!;
  // The S default sets the duration; the disagreeing proposal stays for the hover card to name.
  expect(task.duration).toEqual({ hours: 0.5, source: "default" });
  expect(task.proposal).toMatchObject({ size: "L", runId: run.id });
});

test("loadPlan lays out the bars of tasks with a duration at the project's capacity", async () => {
  const { github, plan, project, number, issue } = await planned();
  await plan.ensureEstimateFields("octo", number);
  await db.update(projects).set({ planHoursPerDay: 8, planMode: "timeline" }).where(eq(projects.id, project.id));
  const story = await issue("Bars", ["story"], await issue("Estimates", ["epic"]));
  const sized = await issue("Sized", ["task"], story);
  const estimated = await issue("Estimated", ["task"], story);
  const dated = await issue("Dated", ["task"], story);
  const item = (n: number) => plan.itemsOf(repo).get(n)!;
  Object.assign(item(sized), { size: "L", start: "2026-10-12" });
  // It starts after the L default's 2 hours on the same day; GitHub's Target disagrees and the bar follows the hours.
  Object.assign(item(estimated), { estimate: 10, start: "2026-10-12", target: "2026-10-12" });
  Object.assign(item(dated), { start: "2026-10-12", target: "2026-10-16" });

  const view = await loadPlan(db, github, plan, project.id, { now: new Date(2026, 9, 10, 12) });
  if ("error" in view) throw new Error(view.error);
  const bar = (n: number) => view.timeline!.items.find((i) => i.number === n)!.planned;
  expect(bar(sized)).toEqual({ start: "2026-10-12", end: "2026-10-12", openStart: false, openEnd: false, hours: 2, offsetHours: 0 });
  expect(bar(estimated)).toEqual({ start: "2026-10-12", end: "2026-10-13", openStart: false, openEnd: false, hours: 10, offsetHours: 2, targetOnGitHub: "2026-10-12" });
  expect(bar(dated)).toEqual({ start: "2026-10-12", end: "2026-10-16", openStart: false, openEnd: false });
});

test("without a plan number loadPlan says there is no plan, and without the project scope it says what is missing", async () => {
  const { github, plan, project } = await planned();
  const bare = await createProject(db, { name: "bare", repo: "octo/bare", defaultBranch: "main" });
  expect(await loadPlan(db, github, plan, bare.id)).toEqual({ reason: "no-plan", error: expect.stringContaining("no plan") });

  expect(await loadPlan(db, github, undefined, project.id)).toEqual({ reason: "no-scope", error: expect.stringContaining("GITHUB_TOKEN") });
  plan.scopesAnswer = { project: false, classic: true };
  expect(await loadPlan(db, github, plan, project.id)).toEqual({ reason: "no-scope", error: expect.stringContaining("gh auth refresh -s project") });
  plan.scopesAnswer = { project: false, classic: false };
  expect(await loadPlan(db, github, plan, project.id)).toEqual({ reason: "no-scope", error: expect.stringContaining("classic token") });

  plan.scopesAnswer = { project: true, classic: true };
  await db.update(projects).set({ planProjectNumber: 9 }).where(eq(projects.id, project.id));
  expect(await loadPlan(db, github, plan, project.id)).toEqual({ reason: "unreachable", error: expect.stringContaining("#9") });
});

test("loadPlan gives a Flow project the flow's input and no timeline, and a Timeline project its timeline and no flow", async () => {
  const { github, plan, project, issue, status } = await planned();
  const first = await issue("Add the column", ["task"]);
  const second = await issue("The Ready gate", ["task"]);
  status(first, "Ready");
  status(second, "Ready");
  plan.itemsOf(repo).get(first)!.start = "2026-10-05";

  const flow = await loadPlan(db, github, plan, project.id);
  if ("error" in flow) throw new Error(flow.error);
  expect(flow.flow?.tasks.map((t) => t.number)).toEqual([first, second]);
  expect(flow.flow).toMatchObject({ lanes: 1, order: "project", runs: [], held: [], minutes: { S: 30, M: 60, L: 120 } });
  expect(flow.timeline).toBeUndefined();

  await db.update(projects).set({ planMode: "timeline" }).where(eq(projects.id, project.id));
  const timeline = await loadPlan(db, github, plan, project.id);
  if ("error" in timeline) throw new Error(timeline.error);
  expect(timeline.flow).toBeUndefined();
  expect(timeline.timeline?.items.find((i) => i.number === first)?.planned).toMatchObject({ start: "2026-10-05" });
});
