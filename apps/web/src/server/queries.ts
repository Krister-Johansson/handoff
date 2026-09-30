import { and, asc, desc, eq, graphVersions, isNull, listEventsAfter, nodeExecutions, projects, questions, runs, type DbExecutor } from "@handoff/db";
import type { StreamedEvent } from "./events-stream";

export async function listRuns(db: DbExecutor, limit = 50) {
  return db
    .select({
      id: runs.id,
      task: runs.task,
      status: runs.status,
      branchName: runs.branchName,
      prNumber: runs.prNumber,
      createdAt: runs.createdAt,
      project: projects.name,
      repo: projects.repoName,
      owner: projects.repoOwner,
    })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .orderBy(desc(runs.createdAt))
    .limit(limit);
}

export async function getRunDetail(db: DbExecutor, runId: string) {
  const [run] = await db
    .select({ run: runs, project: projects })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(eq(runs.id, runId));
  if (!run) return undefined;
  const [executions, eventRows, [version], openQuestions, [failed]] = await Promise.all([
    db
      .select({ id: nodeExecutions.id, nodeKey: nodeExecutions.nodeKey, attempt: nodeExecutions.attempt, status: nodeExecutions.status, costUsd: nodeExecutions.costUsd, startedAt: nodeExecutions.startedAt, finishedAt: nodeExecutions.finishedAt })
      .from(nodeExecutions)
      .where(eq(nodeExecutions.runId, runId))
      .orderBy(asc(nodeExecutions.createdAt)),
    listEventsAfter(db, runId, 0, 1000),
    db.select({ document: graphVersions.document, version: graphVersions.version }).from(graphVersions).where(eq(graphVersions.id, run.run.graphVersionId)),
    db
      .select({ id: questions.id, question: questions.question, options: questions.options, context: questions.context, nodeKey: nodeExecutions.nodeKey })
      .from(questions)
      .innerJoin(nodeExecutions, eq(nodeExecutions.id, questions.nodeExecutionId))
      .where(and(eq(questions.runId, runId), isNull(questions.answer))),
    db
      .select({ id: nodeExecutions.id, nodeKey: nodeExecutions.nodeKey, attempt: nodeExecutions.attempt, error: nodeExecutions.error })
      .from(nodeExecutions)
      .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.status, "failed")))
      .orderBy(desc(nodeExecutions.finishedAt))
      .limit(1),
  ]);
  const events: StreamedEvent[] = eventRows.map((e) => ({
    seq: e.seq,
    type: e.type,
    payload: e.payload,
    nodeExecutionId: e.nodeExecutionId,
    createdAt: e.createdAt.toISOString(),
  }));
  return { ...run, executions, events, graph: version, openQuestions, failed };
}

/** One execution of a run with what it produced, for the run page's node details. */
export async function getExecutionDetail(db: DbExecutor, runId: string, executionId: string) {
  const [row] = await db
    .select({
      id: nodeExecutions.id,
      nodeKey: nodeExecutions.nodeKey,
      nodeType: nodeExecutions.nodeType,
      attempt: nodeExecutions.attempt,
      status: nodeExecutions.status,
      output: nodeExecutions.output,
      checks: nodeExecutions.checks,
      error: nodeExecutions.error,
      trigger: nodeExecutions.trigger,
      costUsd: nodeExecutions.costUsd,
      startedAt: nodeExecutions.startedAt,
      finishedAt: nodeExecutions.finishedAt,
      repairNote: nodeExecutions.repairNote,
    })
    .from(nodeExecutions)
    .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.id, executionId)));
  return row;
}
