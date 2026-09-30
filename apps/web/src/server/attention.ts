import { and, eq, nodeExecutions, projects, runs, sql, type Db } from "@handoff/db";
import type { AttentionItem } from "../lib/attention";
import { listInbox } from "./inbox";

/** Pull requests whose PR node still waits after CI finished, which only happens when it needs an approving review. */
async function waitingReviews(db: Db) {
  const latestPr = sql<{ number?: number; ci?: string } | null>`(
    select e.payload from events e
    where e.node_execution_id = ${nodeExecutions.id} and e.type = 'github.pr'
    order by e.seq desc limit 1
  )`;
  const rows = await db
    .select({ executionId: nodeExecutions.id, runId: runs.id, task: runs.task, projectName: projects.name, pr: latestPr })
    .from(nodeExecutions)
    .innerJoin(runs, eq(runs.id, nodeExecutions.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(eq(nodeExecutions.status, "waiting"), eq(nodeExecutions.waitKind, "github_pr")));
  return rows.filter((r) => r.pr && r.pr.ci !== "pending" && r.pr.number !== undefined);
}

/**
 * Everything that needs a person right now, one item per thing with a stable id, so the dashboard
 * can notify once per new item: open questions, failed runs awaiting repair, PRs waiting for review.
 */
export async function listAttention(db: Db): Promise<AttentionItem[]> {
  const [inbox, reviews] = await Promise.all([listInbox(db), waitingReviews(db)]);
  return [
    ...inbox.questions.map((q): AttentionItem => ({ id: `question:${q.id}`, kind: "question", title: `${q.projectName}: ${q.nodeKey} asks a question`, body: q.question, href: `/runs/${q.runId}` })),
    ...inbox.failedRuns.map((f): AttentionItem => ({ id: `failed:${f.executionId}`, kind: "failed", title: `${f.projectName}: run failed at ${f.nodeKey}`, body: f.task, href: `/runs/${f.runId}` })),
    ...reviews.map((r): AttentionItem => ({
      id: `review:${r.executionId}:${r.pr!.number}`,
      kind: "review",
      title: `${r.projectName}: PR #${r.pr!.number} waits for your review`,
      body: r.task,
      href: `/runs/${r.runId}`,
    })),
  ];
}
