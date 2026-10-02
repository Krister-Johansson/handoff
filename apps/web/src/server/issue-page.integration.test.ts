import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, nodeExecutions, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
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
