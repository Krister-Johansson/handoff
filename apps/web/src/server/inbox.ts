import { and, desc, eq, inArray, isNull, nodeExecutions, projects, questions, runs, sql, type Db } from "@handoff/db";

/** Everything waiting on a person: open questions from Human gates, and failed runs awaiting repair. */
export async function listInbox(db: Db) {
  const [open, failed] = await Promise.all([
    db
      .select({
        id: questions.id,
        question: questions.question,
        options: questions.options,
        context: questions.context,
        createdAt: questions.createdAt,
        runId: runs.id,
        projectId: runs.projectId,
        task: runs.task,
        nodeKey: nodeExecutions.nodeKey,
        projectName: projects.name,
      })
      .from(questions)
      .innerJoin(runs, eq(runs.id, questions.runId))
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .innerJoin(nodeExecutions, eq(nodeExecutions.id, questions.nodeExecutionId))
      .where(and(isNull(questions.answer), inArray(runs.status, ["queued", "running", "waiting"])))
      .orderBy(desc(questions.createdAt)),
    db
      .select({
        runId: runs.id,
        projectId: runs.projectId,
        task: runs.task,
        projectName: projects.name,
        executionId: nodeExecutions.id,
        nodeKey: nodeExecutions.nodeKey,
        attempt: nodeExecutions.attempt,
        error: nodeExecutions.error,
        finishedAt: nodeExecutions.finishedAt,
      })
      .from(runs)
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .innerJoin(nodeExecutions, eq(nodeExecutions.runId, runs.id))
      .where(
        and(
          eq(runs.status, "failed"),
          eq(nodeExecutions.status, "failed"),
          sql`${nodeExecutions.attempt} = (select max(ne.attempt) from node_executions ne where ne.run_id = ${runs.id} and ne.node_key = ${nodeExecutions.nodeKey})`,
        ),
      )
      .orderBy(desc(nodeExecutions.finishedAt)),
  ]);
  return {
    questions: open.map((q) => ({ ...q, reason: typeof q.context.reason === "string" ? q.context.reason : "approval" })),
    failedRuns: failed,
    count: open.length + failed.length,
  };
}

export async function inboxCount(db: Db): Promise<number> {
  return (await listInbox(db)).count;
}
