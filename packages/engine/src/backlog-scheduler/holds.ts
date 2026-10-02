import { and, asc, eq, nodeExecutions, permissionRequests, runs, sql, type DbExecutor } from "@handoff/db";

/**
 * Something in a project that stops the scheduler from starting runs: a failed run, a loop that ran
 * out of rounds, or a pending permission request.
 */
export type Hold =
  | { kind: "failed" | "loop"; runId: string; nodeKey: string }
  | { kind: "permission"; runId: string; nodeKey: string; permissionId: string; toolName: string };

/**
 * What holds a project, from every run of it, whoever started it and however old. A run waiting on
 * a question, a plan or code review, Try it, a pull request review or the merge queue does not hold:
 * it stays active and counts toward the scheduler's limit instead.
 */
export async function projectHolds(db: DbExecutor, projectId: string): Promise<Hold[]> {
  const lastFailure = sql<{ reason?: string; nodeKey?: string } | null>`(
    select e.payload from events e where e.run_id = runs.id and e.type = 'run.failed' order by e.seq desc limit 1
  )`;
  const [failed, permissions] = await Promise.all([
    db.select({ runId: runs.id, failure: lastFailure }).from(runs).where(and(eq(runs.projectId, projectId), eq(runs.status, "failed"))).orderBy(asc(runs.createdAt)),
    db
      .select({ runId: runs.id, nodeKey: nodeExecutions.nodeKey, permissionId: permissionRequests.id, toolName: permissionRequests.toolName })
      .from(permissionRequests)
      .innerJoin(runs, eq(runs.id, permissionRequests.runId))
      .innerJoin(nodeExecutions, eq(nodeExecutions.id, permissionRequests.nodeExecutionId))
      .where(and(eq(runs.projectId, projectId), eq(permissionRequests.status, "pending")))
      .orderBy(asc(permissionRequests.createdAt)),
  ]);
  return [
    ...failed.map((f): Hold => ({ kind: f.failure?.reason === "loop_exhausted" ? "loop" : "failed", runId: f.runId, nodeKey: f.failure?.nodeKey ?? "a step" })),
    ...permissions.map((p): Hold => ({ kind: "permission", ...p })),
  ];
}
