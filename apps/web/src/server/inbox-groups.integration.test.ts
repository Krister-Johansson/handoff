import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, nodeExecutions, permissionRequests, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { answerQuestion } from "@handoff/engine/operations";
import { inboxCount } from "@/components/inbox/inbox-view";
import { inboxGroups, inboxTotal } from "./inbox-groups";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function setUp() {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const start = (task: string) => startRunFromGraph(db, { projectId: project.id, graphName: "g", task });
  return { project, start };
}

test("the inbox groups what waits on a person by what they must do", async () => {
  const { project, start } = await setUp();

  const reviewing = await start("Build a todo app");
  const gate = await seedExecution(db, reviewing.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [review] = await db
    .insert(questions)
    .values({ runId: reviewing.id, nodeExecutionId: gate.id, question: "Approve the plan", options: ["approve", "changes"], context: { reason: "approval", review: { from: "planner", kind: "plan", markdown: "Plan" } } })
    .returning();
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, reviewing.id));

  const asking = await start("Pick a license");
  const ask = await seedExecution(db, asking.id, { nodeKey: "ask", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db.insert(questions).values({ runId: asking.id, nodeExecutionId: ask.id, question: "Which license?", context: { reason: "needs_input" } }).returning();
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, asking.id));

  const broken = await start("Add a CHANGELOG.md");
  const coder = await seedExecution(db, broken.id, { nodeKey: "coder", status: "failed", error: { code: "TESTS_FAILED", message: "2 of 41 tests failed" } });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, broken.id));

  const stuck = await start("Review until done");
  const [planner] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, stuck.id));
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.id, planner!.id));
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, stuck.id));
  await db.transaction((tx) =>
    appendEvents(tx, stuck.id, [
      { type: "edge.exhausted", payload: { edgeKey: "planner->planner", attempts: 3 }, nodeExecutionId: planner!.id },
      { type: "run.failed", payload: { reason: "loop_exhausted", nodeKey: "planner" } },
    ]),
  );

  const pulling = await start("Add usage docs");
  const pr = await seedExecution(db, pulling.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", waitKind: "github_pr" });
  await db.transaction((tx) => appendEvents(tx, pulling.id, [{ type: "github.pr", payload: { number: 7, url: "https://github.com/octo/sample/pull/7", ci: "success", review: "none" }, nodeExecutionId: pr.id }]));
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, pulling.id));

  const groups = await inboxGroups(db);
  expect(groups.reviews).toEqual([expect.objectContaining({ id: review!.id, question: "Approve the plan", runId: reviewing.id, projectName: "sandbox", createdAt: expect.any(Date) })]);
  expect(groups.questions).toEqual([expect.objectContaining({ id: question!.id, question: "Which license?", nodeKey: "ask", reason: "needs_input" })]);
  expect(groups.failedRuns).toEqual([expect.objectContaining({ runId: broken.id, executionId: coder.id, nodeKey: "coder", error: { code: "TESTS_FAILED", message: "2 of 41 tests failed" } })]);
  expect(groups.stuckRuns).toEqual([
    { runId: stuck.id, projectId: project.id, projectName: "sandbox", task: "Review until done", nodeKey: "planner", loop: "planner->planner", attempts: 3, finishedAt: null },
  ]);
  expect(groups.pullRequests).toEqual([
    expect.objectContaining({ runId: pulling.id, projectId: project.id, projectName: "sandbox", task: "Add usage docs", number: 7, url: "https://github.com/octo/sample/pull/7", ci: "success", branch: pulling.branchName }),
  ]);
  expect(groups.count).toBe(5);
});

test("a run stopped by a loop is listed once, as needing a decision rather than a repair", async () => {
  const { start } = await setUp();
  const stuck = await start("Review until done");
  const [planner] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, stuck.id));
  // An earlier attempt of another step failed and was never repaired; the loop is still what stopped the run.
  await seedExecution(db, stuck.id, { nodeKey: "coder", status: "failed" });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, stuck.id));
  await db.transaction((tx) =>
    appendEvents(tx, stuck.id, [
      { type: "edge.exhausted", payload: { edgeKey: "planner->planner", attempts: 3 }, nodeExecutionId: planner!.id },
      { type: "run.failed", payload: { reason: "loop_exhausted", nodeKey: "planner" } },
    ]),
  );
  const groups = await inboxGroups(db);
  expect(groups.stuckRuns.map((s) => s.runId)).toEqual([stuck.id]);
  expect(groups.failedRuns).toEqual([]);
  expect(groups.count).toBe(1);
});

test("the first pull request in each project's merge queue, waiting for a person, is ready to merge", async () => {
  const { project, start } = await setUp();
  const first = await start("First");
  const second = await start("Second");
  const queued = async (runId: string, minutesAgo: number, pr: number) => {
    await db.update(runs).set({ mergeQueuedAt: new Date(Date.now() - minutesAgo * 60_000), prNumber: pr, status: "waiting" }).where(eq(runs.id, runId));
    await seedExecution(db, runId, { nodeKey: "merge", nodeType: "merge", executorKind: "github", status: "waiting", waitKind: "merge_queue", waitKey: `mq:${project.id}` });
  };
  await queued(first.id, 2, 54);
  await queued(second.id, 1, 55);
  const groups = await inboxGroups(db);
  // Only the first can merge now; the second is behind it.
  expect(groups.readyToMerge).toMatchObject([{ runId: first.id, projectId: project.id, projectName: "sandbox", task: "First", prNumber: 54 }]);
  expect(groups.count).toBe(1);

  await db.update(runs).set({ mergeRequestedAt: new Date() }).where(eq(runs.id, first.id));
  expect((await inboxGroups(db)).readyToMerge).toEqual([]);
});

test("narrowed to a project, the inbox holds only that project's items, permission requests included", async () => {
  const { project, start } = await setUp();
  const other = await createProject(db, { name: "elsewhere", repo: "octo/other", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: other.id, name: "g", document: linear });

  const ours = await start("Pick a license");
  const ask = await seedExecution(db, ours.id, { nodeKey: "ask", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: ours.id, nodeExecutionId: ask.id, question: "Which license?", context: { reason: "needs_input" } });
  const coder = await seedExecution(db, ours.id, { nodeKey: "coder", status: "running" });
  await db.insert(permissionRequests).values({ id: crypto.randomUUID(), runId: ours.id, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "pnpm test" } });
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, ours.id));

  const theirs = await startRunFromGraph(db, { projectId: other.id, graphName: "g", task: "Pick a name" });
  const theirAsk = await seedExecution(db, theirs.id, { nodeKey: "ask", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: theirs.id, nodeExecutionId: theirAsk.id, question: "Which name?", context: { reason: "needs_input" } });
  const broken = await startRunFromGraph(db, { projectId: other.id, graphName: "g", task: "Broken" });
  await seedExecution(db, broken.id, { nodeKey: "coder", status: "failed" });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, broken.id));

  const groups = await inboxGroups(db, { projectId: project.id });
  expect(groups.questions.map((q) => q.question)).toEqual(["Which license?"]);
  expect(groups.permissions.map((p) => [p.runId, p.toolName])).toEqual([[ours.id, "Bash"]]);
  expect(groups.failedRuns).toEqual([]);
  expect(groups.count).toBe(2);
  expect((await inboxGroups(db)).count).toBe(4);
});

test("the sidebar's Inbox count and the Inbox page count the same items, and both drop when one is answered", async () => {
  const { start } = await setUp();
  const asking = await start("Pick a license");
  const ask = await seedExecution(db, asking.id, { nodeKey: "ask", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db.insert(questions).values({ runId: asking.id, nodeExecutionId: ask.id, question: "Which license?", context: { reason: "needs_input" } }).returning();
  const coder = await seedExecution(db, asking.id, { nodeKey: "coder", status: "running" });
  await db.insert(permissionRequests).values({ id: crypto.randomUUID(), runId: asking.id, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "pnpm test" } });
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, asking.id));
  const broken = await start("Add a CHANGELOG.md");
  await seedExecution(db, broken.id, { nodeKey: "coder", status: "failed" });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, broken.id));

  // The Inbox page counts the groups it shows; the sidebar reads only the total.
  expect(inboxCount(await inboxGroups(db))).toBe(3);
  expect(await inboxTotal(db)).toBe(3);

  await answerQuestion(db, question!.id, { answer: "MIT", answeredBy: "dashboard" });
  expect(inboxCount(await inboxGroups(db))).toBe(2);
  expect(await inboxTotal(db)).toBe(2);
});
