import { asc, desc, eq, listEventsAfter, nodeExecutions, projects, runs, type DbExecutor } from "@handoff/db";
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
  const executions = await db
    .select({ id: nodeExecutions.id, nodeKey: nodeExecutions.nodeKey, attempt: nodeExecutions.attempt, status: nodeExecutions.status, costUsd: nodeExecutions.costUsd })
    .from(nodeExecutions)
    .where(eq(nodeExecutions.runId, runId))
    .orderBy(asc(nodeExecutions.createdAt));
  const events: StreamedEvent[] = (await listEventsAfter(db, runId, 0, 1000)).map((e) => ({
    seq: e.seq,
    type: e.type,
    payload: e.payload,
    nodeExecutionId: e.nodeExecutionId,
    createdAt: e.createdAt.toISOString(),
  }));
  return { ...run, executions, events };
}
