import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, nodeExecutions, permissionRequests, questions, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { createRun } from "../runs.ts";
import { seedGraph } from "../testing/harness.ts";
import { projectHolds } from "./holds.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** A project with graph g, and a way to add runs to it in the state a test needs. */
async function project() {
  const { project, graphVersion } = await seedGraph(db, linear);
  const run = async (startedBy?: string) => createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Build it", ...(startedBy ? { startedBy } : {}) });
  /** A step of the run in the given state, as the engine leaves it. */
  const step = async (runId: string, nodeKey: string, values: Partial<typeof nodeExecutions.$inferInsert> = {}) => {
    const [row] = await db
      .insert(nodeExecutions)
      .values({ runId, nodeKey, nodeType: nodeKey.replace(/-\d+$/, ""), executorKind: "human", attempt: 1, status: "waiting", ...values })
      .returning();
    return row!;
  };
  const fail = async (reason: "node_failed" | "loop_exhausted", nodeKey = "coder-1", startedBy?: string) => {
    const failed = await run(startedBy);
    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, failed.id));
    await db.transaction((tx) => appendEvents(tx, failed.id, [{ type: "run.failed", payload: { nodeKey, reason, awaiting: "repair" } }]));
    return failed;
  };
  const ask = async (context: Record<string, unknown>, startedBy?: string) => {
    const asking = await run(startedBy);
    await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, asking.id));
    const gate = await step(asking.id, "human_gate-1", { waitKind: "human" });
    const [question] = await db.insert(questions).values({ runId: asking.id, nodeExecutionId: gate.id, question: "Go on?", context }).returning();
    return { run: asking, question: question! };
  };
  const pullRequest = async (ci: "pending" | "success") => {
    const waiting = await run();
    await db.update(runs).set({ status: "waiting", prNumber: 7 }).where(eq(runs.id, waiting.id));
    const pr = await step(waiting.id, "pr-1", { executorKind: "github", waitKind: "github_pr", waitKey: "pr:7" });
    await db.transaction((tx) => appendEvents(tx, waiting.id, [{ type: "github.pr", payload: { number: 7, url: "https://github.com/octo/sample/pull/7", ci }, nodeExecutionId: pr.id }]));
    return waiting;
  };
  const permission = async (startedBy?: string) => {
    const running = await run(startedBy);
    await db.update(runs).set({ status: "running" }).where(eq(runs.id, running.id));
    const coder = await step(running.id, "coder-1", { executorKind: "cli", status: "running" });
    const id = crypto.randomUUID();
    await db.insert(permissionRequests).values({ id, runId: running.id, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "rm -rf build" } });
    return { run: running, id };
  };
  const mergeQueue = async () => {
    const queued = await run();
    await db.update(runs).set({ status: "waiting", prNumber: 8, mergeQueuedAt: new Date() }).where(eq(runs.id, queued.id));
    await step(queued.id, "merge-1", { executorKind: "github", waitKind: "merge_queue", waitKey: `mq:${project.id}` });
    return queued;
  };
  return { project, run, fail, ask, pullRequest, permission, mergeQueue };
}

test("a failed run, a loop out of rounds and a pending permission each hold the project", async () => {
  const quiet = await project();
  await quiet.run();
  await quiet.pullRequest("pending");
  expect(await projectHolds(db, quiet.project.id)).toEqual([]);

  const failed = await project();
  const failedRun = await failed.fail("node_failed");
  expect(await projectHolds(db, failed.project.id)).toEqual([{ kind: "failed", runId: failedRun.id, nodeKey: "coder-1" }]);

  const loop = await project();
  const loopRun = await loop.fail("loop_exhausted", "review-1");
  expect(await projectHolds(db, loop.project.id)).toEqual([{ kind: "loop", runId: loopRun.id, nodeKey: "review-1" }]);

  const asking = await project();
  const request = await asking.permission();
  expect(await projectHolds(db, asking.project.id)).toEqual([{ kind: "permission", runId: request.run.id, nodeKey: "coder-1", permissionId: request.id, toolName: "Bash" }]);
});

test("an open question, a plan or code review, Try it and a pull request waiting for review do not hold", async () => {
  const waiting = await project();
  await waiting.ask({ reason: "question" });
  await waiting.ask({ review: { from: "planner-1", kind: "plan" } });
  await waiting.ask({ review: { from: "review-1", kind: "code" } });
  await waiting.ask({ reason: "try" });
  await waiting.pullRequest("success");
  expect(await projectHolds(db, waiting.project.id)).toEqual([]);
});

test("a pull request waiting in a manual merge queue does not hold", async () => {
  const queued = await project();
  await queued.mergeQueue();
  expect(await projectHolds(db, queued.project.id)).toEqual([]);
});

test("holds count runs a person started", async () => {
  const mine = await project();
  const byHand = await mine.fail("node_failed", "coder-1", "dashboard");
  const fromScheduler = await mine.permission("scheduler");
  // A run of another project never holds this one.
  const other = await project();
  await other.fail("node_failed");

  expect((await projectHolds(db, mine.project.id)).map((h) => [h.kind, h.runId])).toEqual([
    ["failed", byHand.id],
    ["permission", fromScheduler.run.id],
  ]);
});
