import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, nodeExecutions, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { inboxGroups } from "./inbox-groups";

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
