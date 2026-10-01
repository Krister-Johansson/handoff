import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { appendEvents, events, nodeExecutions, questions, runs, wakeByToken, type Db, type QuestionComment } from "@handoff/db";
import type { RunState } from "@handoff/core";
import { loadCompiledGraph } from "./graph-cache.ts";
import { createExecution } from "./scheduler/complete.ts";

/** Re-runs a failed node execution as a new attempt, keeping every upstream result in run state. */
export async function repairNodeExecution(db: Db, executionId: string, opts: { note?: string }) {
  return db.transaction(async (tx) => {
    const [failed] = await tx.select().from(nodeExecutions).where(eq(nodeExecutions.id, executionId)).for("update");
    if (!failed) throw new Error(`execution ${executionId} not found`);
    if (failed.status !== "failed") throw new Error(`only failed executions can be repaired; ${failed.nodeKey} is ${failed.status}`);
    const [run] = await tx.select().from(runs).where(eq(runs.id, failed.runId)).for("update");
    if (run?.status === "cancelled") throw new Error("the run was cancelled");
    const [{ attempt } = { attempt: 0 }] = await tx
      .select({ attempt: sql<number>`coalesce(max(${nodeExecutions.attempt}), 0)::int` })
      .from(nodeExecutions)
      .where(and(eq(nodeExecutions.runId, failed.runId), eq(nodeExecutions.nodeKey, failed.nodeKey)));
    const [created] = await tx
      .insert(nodeExecutions)
      .values({
        runId: failed.runId,
        nodeKey: failed.nodeKey,
        nodeType: failed.nodeType,
        executorKind: failed.executorKind,
        attempt: attempt + 1,
        repairedFromExecutionId: failed.id,
        repairNote: opts.note ?? null,
        trigger: { kind: "repair", fromExecutionId: failed.id },
      })
      .returning();
    await tx.update(runs).set({ status: "running", finishedAt: null }).where(eq(runs.id, failed.runId));
    await appendEvents(tx, failed.runId, [
      { type: "node.repair_requested", payload: { nodeKey: failed.nodeKey, note: opts.note ?? null }, nodeExecutionId: failed.id },
      { type: "node.created", payload: { nodeKey: failed.nodeKey, attempt: attempt + 1, via: "repair" }, nodeExecutionId: created!.id },
    ]);
    return created!;
  });
}

/** Cancels a run: stops claiming its work, fails queued and waiting nodes, and signals the running one. */
export async function cancelRun(db: Db, runId: string, opts: { reason?: string } = {}) {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .update(runs)
      .set({ status: "cancelled", cancelRequestedAt: sql`now()`, finishedAt: sql`now()` })
      .where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "running", "waiting", "failed"])))
      .returning();
    if (!run) throw new Error(`run ${runId} is not active`);
    await tx
      .update(nodeExecutions)
      .set({ status: "failed", error: { code: "cancelled", message: "run was cancelled" }, finishedAt: sql`now()` })
      .where(and(eq(nodeExecutions.runId, runId), inArray(nodeExecutions.status, ["pending", "waiting"])));
    await appendEvents(tx, runId, [{ type: "run.cancelled", payload: { reason: opts.reason ?? null } }]);
  });
}

/** Records a person's answer and wakes the Human gate waiting on it. */
export async function answerQuestion(
  db: Db,
  questionId: string,
  input: { answer: string; option?: string; answeredBy: string; comments?: QuestionComment[] },
) {
  const comments = (input.comments ?? [])
    .map(
      (c): QuestionComment => ({
        ...(c.path?.trim() ? { path: c.path.trim() } : {}),
        ...(c.line !== undefined ? { line: c.line } : {}),
        ...(c.endLine !== undefined && c.endLine !== c.line ? { endLine: c.endLine } : {}),
        ...(c.side ? { side: c.side } : {}),
        // Code keeps its indentation; a quote from prose is trimmed.
        ...(c.quote?.trim() ? { quote: c.path ? c.quote : c.quote.trim() } : {}),
        body: c.body.trim(),
      }),
    )
    .filter((c) => c.body);
  return db.transaction(async (tx) => {
    const [question] = await tx
      .update(questions)
      .set({ answer: input.answer, option: input.option ?? null, comments, answeredBy: input.answeredBy, answeredAt: sql`now()` })
      .where(and(eq(questions.id, questionId), sql`${questions.answer} is null`))
      .returning();
    if (!question) {
      const [existing] = await tx.select({ id: questions.id }).from(questions).where(eq(questions.id, questionId));
      throw new Error(existing ? "question already answered" : `question ${questionId} not found`);
    }
    await wakeByToken(tx, question.id, { reason: "answer", payload: { option: input.option ?? null, answeredBy: input.answeredBy } });
    await appendEvents(tx, question.runId, [
      {
        type: "human.answered",
        payload: { questionId: question.id, answer: input.answer, option: input.option ?? null, comments: comments.length, answeredBy: input.answeredBy },
        nodeExecutionId: question.nodeExecutionId,
      },
    ]);
    return question;
  });
}

export type StuckLoop = { nodeKey: string; edgeKey: string; attempts: number; executionId: string };

/**
 * Where a run stopped because a loop used all its attempts (a reviewer kept sending work back, say):
 * the step that wanted another round and the loop edge. Undefined for any run not stopped that way.
 */
export async function stuckLoop(db: Db, runId: string): Promise<StuckLoop | undefined> {
  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
  if (run?.status !== "failed") return undefined;
  const [failed] = await db.select({ payload: events.payload }).from(events).where(and(eq(events.runId, runId), eq(events.type, "run.failed"))).orderBy(desc(events.seq)).limit(1);
  if ((failed?.payload as { reason?: string } | undefined)?.reason !== "loop_exhausted") return undefined;
  const [exhausted] = await db
    .select({ payload: events.payload, executionId: events.nodeExecutionId })
    .from(events)
    .where(and(eq(events.runId, runId), eq(events.type, "edge.exhausted")))
    .orderBy(desc(events.seq))
    .limit(1);
  if (!exhausted?.executionId) return undefined;
  const [execution] = await db.select({ nodeKey: nodeExecutions.nodeKey }).from(nodeExecutions).where(eq(nodeExecutions.id, exhausted.executionId));
  const payload = exhausted.payload as { edgeKey: string; attempts: number };
  return { nodeKey: execution!.nodeKey, edgeKey: payload.edgeKey, attempts: payload.attempts, executionId: exhausted.executionId };
}

/**
 * A person's decision for a run stuck on a loop that ran out: another round (the loop starts over and
 * the work goes back once more), go on as if the step approved (its forward edges are taken), or stop.
 */
export async function resolveExhaustedLoop(db: Db, runId: string, action: "retry" | "continue" | "stop") {
  const stuck = await stuckLoop(db, runId);
  if (!stuck) throw new Error("This run was not stopped by a loop that ran out of attempts.");
  if (action === "stop") return cancelRun(db, runId, { reason: `stopped after ${stuck.edgeKey} ran out of attempts` });
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update");
    const graph = await loadCompiledGraph(tx, run!.graphVersionId);
    const out = graph.outEdges(stuck.nodeKey);
    const edges = action === "retry" ? out.filter((e) => e.key === stuck.edgeKey) : out.filter((e) => !e.loop);
    if (edges.length === 0) throw new Error(action === "retry" ? `The graph no longer has ${stuck.edgeKey}.` : `${stuck.nodeKey} has no way forward other than its loops.`);
    // Another round counts as the loop's first attempt again.
    const current = run!.state as RunState;
    const state = action === "retry" ? { ...current, loops: { ...current.loops, [stuck.edgeKey]: { attempts: 1 } } } : current;
    const created = [];
    for (const edge of edges) {
      const exec = await createExecution(tx, graph, runId, edge.target, { kind: "edge", edgeKey: edge.key, from: stuck.nodeKey, fromExecutionId: stuck.executionId });
      created.push({ type: "node.created", payload: { nodeKey: edge.target, attempt: exec.attempt, via: edge.key }, nodeExecutionId: exec.id });
    }
    await tx.update(runs).set({ status: "running", finishedAt: null, state, stateVersion: sql`${runs.stateVersion} + 1` }).where(eq(runs.id, runId));
    await appendEvents(tx, runId, [{ type: "loop.resolved", payload: { action, edgeKey: stuck.edgeKey, nodeKey: stuck.nodeKey }, nodeExecutionId: stuck.executionId }, ...created]);
  });
}

export { mergeQueue, requestMerge, requestMergeAll, type QueueEntry } from "./merge-queue.ts";
