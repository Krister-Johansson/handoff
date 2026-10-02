import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { appendEvents, events, nodeExecutions, permissionRequests, projects as projectRows, questions, runs, wakeByToken, type Db, type QuestionComment } from "@handoff/db";
import type { RunState } from "@handoff/core";
import type { ProjectsPort } from "@handoff/github";
import { loadCompiledGraph } from "./graph-cache.ts";
import { writePlanStatus } from "./plan-status.ts";
import { stopRunPreviews } from "./preview/preview.ts";
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

/**
 * Cancels a run: stops claiming its work, fails queued and waiting nodes, signals the running one, and stops its apps.
 * With the Projects port, the run's tasks go back to Ready on the plan, so they return to the backlog.
 */
export async function cancelRun(db: Db, runId: string, opts: { reason?: string; projects?: ProjectsPort } = {}) {
  const cancelled = await db.transaction(async (tx) => {
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
    return run;
  });
  await stopRunPreviews(db, runId);
  const [project] = await db.select().from(projectRows).where(eq(projectRows.id, cancelled.projectId));
  if (!project || project.planProjectNumber === null || cancelled.issues.length === 0) return;
  const written = await writePlanStatus(opts.projects, project, await latestRunOf(db, cancelled), "Ready");
  if (written.length) await db.transaction((tx) => appendEvents(tx, runId, written));
}

/** The run's issues it is the latest run of: a newer run that links an issue owns its status. */
async function latestRunOf(db: Db, run: typeof runs.$inferSelect): Promise<number[]> {
  const newer = await db
    .select({ issues: runs.issues })
    .from(runs)
    // Compared in SQL: a JavaScript Date drops the microseconds Postgres keeps.
    .where(and(eq(runs.projectId, run.projectId), sql`${runs.createdAt} > (select r.created_at from runs r where r.id = ${run.id})`));
  const taken = new Set(newer.flatMap((r) => r.issues.map((i) => i.number)));
  return run.issues.map((i) => i.number).filter((n) => !taken.has(n));
}

/**
 * Records a person's answer to a step's permission request; the step's watcher hands it to Claude Code.
 * A request already answered, or expired when its step ended, cannot be answered again.
 */
export async function decidePermission(db: Db, id: string, input: { allow: boolean; decidedBy: string; message?: string; rule?: string }) {
  const [row] = await db
    .update(permissionRequests)
    .set({ status: input.allow ? "allowed" : "denied", decidedBy: input.decidedBy, decidedAt: new Date(), message: input.message ?? null, rule: input.rule ?? null })
    .where(and(eq(permissionRequests.id, id), eq(permissionRequests.status, "pending")))
    .returning();
  if (!row) throw new Error("That request was already answered, or its step has ended.");
  return row;
}

/** Wakes a Try it gate that still waits for its answer, so it starts the run's app again if it stopped. */
export async function restartTryIt(db: Db, questionId: string) {
  const [question] = await db.select().from(questions).where(eq(questions.id, questionId));
  if (!question || question.answer !== null) throw new Error(`question ${questionId} is not waiting`);
  await wakeByToken(db, questionId, { reason: "preview" });
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
