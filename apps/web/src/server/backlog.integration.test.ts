import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { listBacklog } from "./backlog.ts";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("the backlog lists open issues with the latest run that works on each, if any", async () => {
  const github = new FakeGitHub();
  for (const [number, title] of [[12, "Slugify drops digits"], [14, "Document slugify"], [15, "Add a license"]] as const) {
    github.issues.set(number, { number, title, url: `https://github.com/octo/sample/issues/${number}`, body: "", state: "open", updatedAt: `2026-09-30T0${number - 10}:00:00Z` });
  }
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const first = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [12] }, github);
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, first.id));
  const second = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [12, 14] }, github);
  await db.update(runs).set({ status: "waiting", prNumber: 21 }).where(eq(runs.id, second.id));

  const backlog = await listBacklog(db, github, project.id);
  expect(backlog.issues.map((i) => [i.number, i.run?.id ?? null, i.run?.status ?? null, i.run?.prNumber ?? null])).toEqual([
    [15, null, null, null],
    [14, second.id, "waiting", 21],
    [12, second.id, "waiting", 21],
  ]);
  expect(backlog.counts).toEqual({ todo: 1, started: 2, all: 3 });
});

test("without GitHub access the backlog says so", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  expect(await listBacklog(db, undefined, project.id)).toMatchObject({ error: expect.stringContaining("GitHub") });
});

test("issues that can start come before blocked ones, each part keeping GitHub's order", async () => {
  const github = new FakeGitHub();
  const set = (number: number, hour: number, blockedBy: number[] = []) =>
    github.issues.set(number, { number, title: `F${number}`, url: `u${number}`, body: "", state: "open", updatedAt: `2026-09-30T0${hour}:00:00Z`, blockedBy });
  set(7, 9, [5, 6]);
  set(6, 8);
  set(13, 7, [10]);
  set(5, 6);
  set(10, 5);
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  const backlog = await listBacklog(db, github, project.id);
  expect(backlog.issues.map((i) => i.number)).toEqual([6, 5, 10, 7, 13]);
});

const repo = { owner: "octo", name: "sample" };

/** A project whose plan is the repository's GitHub Project; `issue` creates an issue in it, updated at `hour`. */
async function planned() {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const issue = async (title: string, labels: string[], hour: number, opts: { parent?: number; status?: string } = {}) => {
    const created = (await plan.createIssue(repo, { project: number, title, body: "", labels, parent: opts.parent })).number;
    github.issues.get(created)!.updatedAt = `2026-09-30T${String(hour).padStart(2, "0")}:00:00Z`;
    if (opts.status) plan.itemsOf(repo).get(created)!.status = opts.status;
    return created;
  };
  const unplanned = (number: number, hour: number) =>
    github.issues.set(number, { number, title: `Bug ${number}`, url: `u${number}`, body: "", state: "open", updatedAt: `2026-09-30T${String(hour).padStart(2, "0")}:00:00Z` });
  return { github, plan, project, issue, unplanned };
}

test("with a plan, the backlog is the Ready tasks without a run plus the unplanned issues, blocked ones last", async () => {
  const { github, plan, project, issue, unplanned } = await planned();
  const epic = await issue("Project management", ["epic"], 1);
  const story = await issue("Plan read model", ["story"], 2, { parent: epic });
  const shaping = await issue("Still shaping", ["task"], 3, { parent: story });
  const blocked = await issue("Waits on the shaping one", ["task"], 9, { parent: story, status: "Ready" });
  github.issues.get(blocked)!.blockedBy = [shaping];
  const ready = await issue("Ready to build", ["task"], 5, { parent: story, status: "Ready" });
  const taken = await issue("Ready but running", ["task"], 6, { parent: story, status: "Ready" });
  unplanned(90, 7);
  unplanned(91, 4);
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [taken, 91] }, github);

  const backlog = await listBacklog(db, github, project.id, plan);
  if ("error" in backlog) throw new Error(backlog.error);
  expect(backlog.issues.map((i) => [i.number, i.plan, i.run?.id ?? null])).toEqual([
    [90, { kind: undefined, status: undefined, planned: false }, null],
    [ready, { kind: "task", status: "Ready", planned: true }, null],
    [91, { kind: undefined, status: undefined, planned: false }, run.id],
    [blocked, { kind: "task", status: "Ready", planned: true }, null],
  ]);
  expect(backlog.counts).toEqual({ todo: 3, started: 1, all: 4 });
});

test("epics and stories never enter the backlog", async () => {
  const { github, plan, project, issue } = await planned();
  const epic = await issue("Project management", ["epic"], 1, { status: "Ready" });
  const story = await issue("Plan read model", ["story"], 2, { parent: epic, status: "Ready" });
  const task = await issue("Add the column", ["task"], 3, { parent: story, status: "Ready" });

  const backlog = await listBacklog(db, github, project.id, plan);
  if ("error" in backlog) throw new Error(backlog.error);
  expect(backlog.issues.map((i) => i.number)).toEqual([task]);
});

test("a cancelled run gives a Ready task back", async () => {
  const { github, plan, project, issue } = await planned();
  const task = await issue("Add the column", ["task"], 3, { status: "Ready" });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [task] }, github);
  const listed = async () => {
    const backlog = await listBacklog(db, github, project.id, plan);
    if ("error" in backlog) throw new Error(backlog.error);
    return backlog.issues.map((i) => [i.number, i.run?.status ?? null]);
  };
  expect(await listed()).toEqual([]);
  await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, run.id));
  expect(await listed()).toEqual([[task, "cancelled"]]);
});
