import { and, asc, eq, inArray, isNull, nodeExecutions, permissionRequests, questions, runs, sql, type DbExecutor } from "@handoff/db";

/**
 * Something in a project that waits on a person, and so stops the scheduler from starting runs:
 * a failed run, a loop that ran out of rounds, an open question, a review gate's question (a plan
 * review, a code review, Try it), a pull request waiting for an approving review, or a pending
 * permission request.
 */
export type Hold =
  | { kind: "failed" | "loop"; runId: string; nodeKey: string }
  | { kind: "question" | "review"; runId: string; nodeKey: string; questionId: string }
  | { kind: "pull_request"; runId: string; prNumber: number }
  | { kind: "permission"; runId: string; nodeKey: string; permissionId: string; toolName: string };

const ACTIVE = ["queued", "running", "waiting"] as const;

/** A review gate's question shows something to approve; Try it asks a person to try the change. */
const isReview = (context: Record<string, unknown>) => Boolean(context.review) || context.reason === "try";

/**
 * What holds a project, from every run of it, whoever started it and however old. A pull request
 * waiting in the merge queue for a person to merge it does not hold: its run counts toward the
 * scheduler's limit instead.
 */
export async function projectHolds(db: DbExecutor, projectId: string): Promise<Hold[]> {
  const lastFailure = sql<{ reason?: string; nodeKey?: string } | null>`(
    select e.payload from events e where e.run_id = runs.id and e.type = 'run.failed' order by e.seq desc limit 1
  )`;
  const latestPr = sql<{ number?: number; ci?: string } | null>`(
    select e.payload from events e
    where e.node_execution_id = ${nodeExecutions.id} and e.type = 'github.pr'
    order by e.seq desc limit 1
  )`;
  const [failed, open, prs, permissions] = await Promise.all([
    db.select({ runId: runs.id, failure: lastFailure }).from(runs).where(and(eq(runs.projectId, projectId), eq(runs.status, "failed"))).orderBy(asc(runs.createdAt)),
    db
      .select({ runId: runs.id, nodeKey: nodeExecutions.nodeKey, questionId: questions.id, context: questions.context })
      .from(questions)
      .innerJoin(runs, eq(runs.id, questions.runId))
      .innerJoin(nodeExecutions, eq(nodeExecutions.id, questions.nodeExecutionId))
      .where(and(eq(runs.projectId, projectId), isNull(questions.answer), inArray(runs.status, [...ACTIVE])))
      .orderBy(asc(questions.createdAt)),
    db
      .select({ runId: runs.id, pr: latestPr })
      .from(nodeExecutions)
      .innerJoin(runs, eq(runs.id, nodeExecutions.runId))
      .where(and(eq(runs.projectId, projectId), inArray(runs.status, [...ACTIVE]), eq(nodeExecutions.status, "waiting"), eq(nodeExecutions.waitKind, "github_pr")))
      .orderBy(asc(nodeExecutions.createdAt)),
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
    ...open.map((q): Hold => ({ kind: isReview(q.context) ? "review" : "question", runId: q.runId, nodeKey: q.nodeKey, questionId: q.questionId })),
    // A PR node keeps waiting after CI finished only when it needs an approving review.
    ...prs.flatMap((p): Hold[] => (p.pr && p.pr.ci !== "pending" && p.pr.number !== undefined ? [{ kind: "pull_request", runId: p.runId, prNumber: p.pr.number }] : [])),
    ...permissions.map((p): Hold => ({ kind: "permission", ...p })),
  ];
}
