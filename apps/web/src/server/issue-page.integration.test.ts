import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, nodeExecutions, projects, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import { issueRuns, loadIssuePage } from "./issue-page.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const url = (n: number) => `https://github.com/octo/sample/issues/${n}`;

/** A project on octo/sample with graph linear, and a fake GitHub with open issues by number and title. */
async function project(issues: Record<number, string> = { 16: "F16 Drag and drop on the board", 17: "Another issue" }) {
  const created = await createProject(db, { name: "todooverkill", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: created.id, name: "linear", document: linear });
  const github = new FakeGitHub();
  for (const [n, title] of Object.entries(issues)) {
    github.issues.set(Number(n), { number: Number(n), title, url: url(Number(n)), body: `Body of ${title}`, state: "open", author: "ann", createdAt: "2026-09-30T10:00:00Z" });
  }
  const start = (issues: number[]) => startRunFromGraph(db, { projectId: created.id, graphName: "linear", task: "", issues }, github);
  return { project: created, github, start };
}

test("issueRuns lists every run on the issue newest first, with its graph, branch, start, steps so far and the review it waits on", async () => {
  const { project: p, start } = await project();
  const older = await start([16]);
  await db.update(runs).set({ status: "cancelled", createdAt: new Date("2026-10-01T17:05:00Z") }).where(eq(runs.id, older.id));
  await start([17]);
  const current = await start([16]);
  await db.update(runs).set({ status: "waiting", startedAt: new Date("2026-10-02T14:08:00Z") }).where(eq(runs.id, current.id));
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, current.id));
  const gate = await seedExecution(db, current.id, { nodeKey: "coder", status: "waiting" });
  const [review] = await db
    .insert(questions)
    .values({ runId: current.id, nodeExecutionId: gate.id, question: "Review the plan from planner", context: { review: { from: "planner", kind: "plan" } } })
    .returning();

  const listed = await issueRuns(db, p.id, 16);
  expect(listed.map((r) => r.id)).toEqual([current.id, older.id]);
  expect(listed[0]).toMatchObject({
    status: "waiting",
    graph: "linear",
    version: 1,
    branch: current.branchName,
    startedAt: new Date("2026-10-02T14:08:00Z"),
    needsYou: true,
    waitingOn: { kind: "review", text: "Review the plan from planner", href: `/projects/${p.id}/runs/${current.id}/review/${review!.id}` },
  });
  expect(listed[0]!.line.steps.map((s) => [s.nodeKey, s.status])).toEqual([
    ["planner", "passed"],
    ["coder", "waiting"],
  ]);
  expect(listed[1]).toMatchObject({ status: "cancelled", needsYou: false, waitingOn: null });
  // The first start found #16 with nobody assigned and assigned the token's user; the second found it assigned.
  expect(listed.map((r) => r.assigned)).toEqual([null, "octocat"]);
});

test("an issue outside the plan reads with its facts, blockers, the issues it blocks, its comments and the token's user, under Issues", async () => {
  const { project: p, github } = await project({ 8: "Theme switch", 15: "Move menu", 16: "Drag and drop", 88: "Reorder subtasks", 145: "Restyle columns" });
  github.issues.get(8)!.state = "closed";
  Object.assign(github.issues.get(16)!, { labels: ["projects-tasks"], blockedBy: [8, 145], authorAssociation: "OWNER" });
  github.issues.get(88)!.blockedBy = [16];
  github.comment(16, "ann", "Notes from the review", { at: "2026-10-01T22:17:00Z", association: "OWNER" });

  const page = await loadIssuePage(db, github, undefined, p.id, 16);
  expect(page).toMatchObject({
    state: "found",
    section: "issues",
    kind: "issue",
    issue: { number: 16, title: "Drag and drop", body: "Body of Drag and drop", labels: ["projects-tasks"], author: "ann", authorAssociation: "OWNER", assignees: [] },
    place: { planned: false, reason: "no-scope" },
    viewer: "octocat",
  });
  if (page.state !== "found") throw new Error("not found");
  // Open blockers first, then the closed ones.
  expect(page.blockedBy.map((b) => [b.number, b.title, b.state])).toEqual([
    [145, "Restyle columns", "open"],
    [8, "Theme switch", "closed"],
  ]);
  expect(page.blocking.map((b) => b.number)).toEqual([88]);
  expect(page.comments.map((c) => [c.author, c.authorAssociation, c.body])).toEqual([["ann", "OWNER", "Notes from the review"]]);
});

const repo = { owner: "octo", name: "sample" };

/**
 * todooverkill's epic #1 with story #2 and its tasks #3 (Running, blocked by #6 and the closed #7) and
 * #4 (Ready, blocked by #3), plus story #5 with its own task; GitHub keeps the story's tasks in the order 4, 3.
 */
async function planned() {
  const { project: p, github, start } = await project({});
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "todooverkill plan");
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, p.id));
  const issue = async (title: string, labels: string[], parent?: number, blockedBy?: number[]) =>
    (await plan.createIssue(repo, { project: number, title, body: `${title} body`, labels, parent, blockedBy })).number;
  const status = (n: number, value: string) => {
    plan.itemsOf(repo).get(n)!.status = value;
  };
  const epic = await issue("Finish Milestone 1", ["epic"]);
  const story = await issue("Board interactions", ["story"], epic);
  github.issues.set(6, { number: 6, title: "Restyle columns", url: url(6), body: "", state: "open" });
  github.issues.set(7, { number: 7, title: "Move menu", url: url(7), body: "", state: "closed" });
  const task = await issue("Drag and drop", ["task"], story, [6, 7]);
  const second = await issue("Reorder subtasks", ["task"], story, [task]);
  github.parents.delete(task);
  github.parents.set(task, story);
  const other = await issue("Labels end to end", ["story"], epic);
  const otherTask = await issue("Label editor", ["task"], other, [6]);
  status(task, "Running");
  status(second, "Ready");
  return { project: p, github, plan, number, start, epic, story, task, second, other, otherTask, status };
}

test("a task of the plan reads under Plan with its Status, its story and epic with their progress, and its blockers' statuses", async () => {
  const { project: p, github, plan, epic, story, task, second } = await planned();
  const page = await loadIssuePage(db, github, plan, p.id, task);
  if (page.state !== "found") throw new Error(page.state);
  expect(page).toMatchObject({ section: "plan", kind: "task", place: { planned: true, project: { title: "todooverkill plan" }, item: { number: task, status: "Running" } } });
  if (!page.place.planned) throw new Error("not planned");
  expect(page.place.parents.map((x) => [x.kind, x.number, x.title, `${x.progress.done} of ${x.progress.total}`])).toEqual([
    ["story", story, "Board interactions", "0 of 2"],
    ["epic", epic, "Finish Milestone 1", "0 of 3"],
  ]);
  expect(page.blockedBy.map((b) => [b.number, b.state, b.status])).toEqual([
    [6, "open", undefined],
    [7, "closed", undefined],
  ]);
  expect(page.blocking.map((b) => [b.number, b.status])).toEqual([[second, "Ready"]]);
});

test("a story lists its tasks in GitHub's sub-issue order, marks the one whose run needs you, and narrows the timeline to itself and its tasks", async () => {
  const { project: p, github, plan, epic, story, task, second, status } = await planned();
  status(task, "Ready");
  github.issues.get(6)!.state = "closed";
  const run = await startRunFromGraph(db, { projectId: p.id, graphName: "linear", task: "", issues: [task] }, github, plan);
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run.id));
  await db.update(nodeExecutions).set({ status: "failed" }).where(eq(nodeExecutions.runId, run.id));

  const page = await loadIssuePage(db, github, plan, p.id, story);
  if (page.state !== "found" || !page.place.planned || page.place.kind !== "story") throw new Error("not a story");
  expect(page.section).toBe("plan");
  expect(page.place.item.tasks.map((t) => [t.number, t.needsYou])).toEqual([
    [second, false],
    [task, true],
  ]);
  expect(page.place.parents.map((x) => x.number)).toEqual([epic]);
  expect(page.place.timeline.items.map((i) => i.number).sort()).toEqual([story, task, second].sort());
});

test("an epic lists its stories in GitHub's order and what waits: the open blockers that hold its tasks, the one holding the most first", async () => {
  const { project: p, github, plan, epic, story, other, task } = await planned();
  github.parents.delete(story);
  github.parents.set(story, epic);

  const page = await loadIssuePage(db, github, plan, p.id, epic);
  if (page.state !== "found" || !page.place.planned || page.place.kind !== "epic") throw new Error("not an epic");
  expect(page.place.item.stories.map((s) => s.number)).toEqual([other, story]);
  expect(page.place.item.progress).toMatchObject({ done: 0, total: 3 });
  expect(page.place.waiting).toEqual({
    needsYou: [],
    waitingTasks: 3,
    blockers: [
      { number: 6, title: "Restyle columns", url: url(6), status: undefined, blocks: 2 },
      { number: task, title: "Drag and drop", url: url(task), status: "Running", blocks: 1 },
    ],
  });
  expect(page.place.timeline?.items.map((i) => i.number).sort()).toEqual([epic, story, other].sort());
});

test("the pull requests of an issue come from its runs and GitHub's links, each with its state, checks and review decision; a story's are its tasks'", async () => {
  const { project: p, github, plan, story, task, status } = await planned();
  status(task, "Ready");
  github.issues.get(6)!.state = "closed";
  const run = await startRunFromGraph(db, { projectId: p.id, graphName: "linear", task: "", issues: [task] }, github, plan);
  const pr = await github.createPr(repo, { head: run.branchName, base: "main", title: "Drag and drop on the board", body: "" });
  await db.update(runs).set({ prNumber: pr.number }).where(eq(runs.id, run.id));
  github.setChecks(pr.number, "FAILURE", [{ name: "test", jobId: 5 }]);
  github.prs.get(pr.number)!.checks!.contexts.push({ name: "lint", status: "COMPLETED", conclusion: "SUCCESS", url: "u" }, { name: "e2e", status: "IN_PROGRESS", conclusion: null, url: "u" });
  github.review(pr.number, "CHANGES_REQUESTED");
  const linked = await github.createPr(repo, { head: "by-hand", base: "main", title: "Fix by hand", body: "" });
  github.prs.get(linked.number)!.draft = true;
  plan.itemsOf(repo).get(task)!.prNumbers = [linked.number];

  const pulls = { number: pr.number, title: "Drag and drop on the board", url: pr.url, state: "open", draft: false, checks: { state: "FAILURE", passed: 1, failed: 1, pending: 1 }, reviewDecision: "CHANGES_REQUESTED" };
  const page = await loadIssuePage(db, github, plan, p.id, task);
  if (page.state !== "found") throw new Error(page.state);
  expect(page.pulls).toEqual([pulls, expect.objectContaining({ number: linked.number, draft: true, checks: { state: "PENDING", passed: 0, failed: 0, pending: 0 } })]);

  const storyPage = await loadIssuePage(db, github, plan, p.id, story);
  if (storyPage.state !== "found") throw new Error(storyPage.state);
  expect(storyPage.pulls.map((x) => x.number)).toEqual([pr.number, linked.number]);
});

test("an open issue outside a project's plan offers the plan's stories, each with its epic, for Plan it", async () => {
  const { project: p, github, plan, story, other } = await planned();
  github.issues.set(40, { number: 40, title: "A bug found by hand", url: url(40), body: "", state: "open" });
  const page = await loadIssuePage(db, github, plan, p.id, 40);
  if (page.state !== "found" || page.place.planned) throw new Error("not unplanned");
  expect(page).toMatchObject({ section: "issues", kind: "issue", place: { planned: false, project: { title: "todooverkill plan" } } });
  expect(page.place.stories).toEqual([
    { number: story, title: "Board interactions", epic: "Finish Milestone 1" },
    { number: other, title: "Labels end to end", epic: "Finish Milestone 1" },
  ]);
});

test("a number GitHub does not know is not found, a pull request's number says so, and an unreachable GitHub keeps the title the latest run linked", async () => {
  const { project: p, github, start } = await project();
  expect(await loadIssuePage(db, github, undefined, p.id, 999)).toEqual({ state: "not-found" });

  github.issues.delete(17);
  const pr = await github.createPr({ owner: "octo", name: "sample" }, { head: "b", base: "main", title: "Add drag", body: "" });
  github.issues.delete(pr.number);
  expect(await loadIssuePage(db, github, undefined, p.id, pr.number)).toEqual({ state: "pull-request", url: pr.url });

  await start([16]);
  github.unreachable = true;
  expect(await loadIssuePage(db, github, undefined, p.id, 16)).toEqual({ state: "unreachable", error: expect.any(String), title: "F16 Drag and drop on the board" });
  expect(await loadIssuePage(db, undefined, undefined, p.id, 16)).toMatchObject({ state: "unreachable", title: "F16 Drag and drop on the board" });
});
