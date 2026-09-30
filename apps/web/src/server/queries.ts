import { and, asc, desc, eq, graphs, graphVersions, inArray, isNull, listEventsAfter, nodeExecutions, projects, questions, runs, type DbExecutor } from "@handoff/db";
import type { RunFilter } from "../lib/run-filter.ts";
import type { StreamedEvent } from "./events-stream";

/** Newest first, optionally narrowed to a status ("active" covers queued, running and waiting) and a project name. */
export async function listRuns(db: DbExecutor, filter: RunFilter = {}, limit = 50) {
  const status =
    filter.status === "active" ? inArray(runs.status, ["queued", "running", "waiting"]) : filter.status ? eq(runs.status, filter.status) : undefined;
  return db
    .select({
      id: runs.id,
      task: runs.task,
      issues: runs.issues,
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
    .where(and(status, filter.project ? eq(projects.name, filter.project) : undefined))
    .orderBy(desc(runs.createdAt))
    .limit(limit);
}

/** Each run's latest step still in progress (running, waiting or pending), for listing active runs. */
export async function currentSteps(db: DbExecutor, runIds: string[]) {
  if (runIds.length === 0) return new Map<string, { nodeKey: string; attempt: number; status: string; since: Date | null }>();
  const rows = await db
    .select({
      runId: nodeExecutions.runId,
      nodeKey: nodeExecutions.nodeKey,
      attempt: nodeExecutions.attempt,
      status: nodeExecutions.status,
      startedAt: nodeExecutions.startedAt,
      createdAt: nodeExecutions.createdAt,
    })
    .from(nodeExecutions)
    .where(and(inArray(nodeExecutions.runId, runIds), inArray(nodeExecutions.status, ["running", "waiting", "pending"])))
    .orderBy(desc(nodeExecutions.createdAt));
  const steps = new Map<string, { nodeKey: string; attempt: number; status: string; since: Date | null }>();
  for (const r of rows) if (!steps.has(r.runId)) steps.set(r.runId, { nodeKey: r.nodeKey, attempt: r.attempt, status: r.status, since: r.startedAt ?? r.createdAt });
  return steps;
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
      .select({
        id: nodeExecutions.id,
        nodeKey: nodeExecutions.nodeKey,
        attempt: nodeExecutions.attempt,
        status: nodeExecutions.status,
        costUsd: nodeExecutions.costUsd,
        startedAt: nodeExecutions.startedAt,
        finishedAt: nodeExecutions.finishedAt,
        output: nodeExecutions.output,
        error: nodeExecutions.error,
      })
      .from(nodeExecutions)
      .where(eq(nodeExecutions.runId, runId))
      .orderBy(asc(nodeExecutions.createdAt)),
    listEventsAfter(db, runId, 0, 1000),
    db
      .select({ document: graphVersions.document, version: graphVersions.version, name: graphs.name })
      .from(graphVersions)
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(eq(graphVersions.id, run.run.graphVersionId)),
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
