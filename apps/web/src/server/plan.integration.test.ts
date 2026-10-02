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
  return { github, plan, project, issue, status };
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
