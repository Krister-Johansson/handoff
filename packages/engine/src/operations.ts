import { and, eq, inArray, sql } from "drizzle-orm";
import { appendEvents, nodeExecutions, questions, runs, wakeByToken, type Db } from "@handoff/db";

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
export async function answerQuestion(db: Db, questionId: string, input: { answer: string; option?: string; answeredBy: string }) {
  return db.transaction(async (tx) => {
    const [question] = await tx
      .update(questions)
      .set({ answer: input.answer, option: input.option ?? null, answeredBy: input.answeredBy, answeredAt: sql`now()` })
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
        payload: { questionId: question.id, answer: input.answer, option: input.option ?? null, answeredBy: input.answeredBy },
        nodeExecutionId: question.nodeExecutionId,
      },
    ]);
    return question;
  });
}
