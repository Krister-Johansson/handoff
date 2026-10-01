import { and, appendEvents, desc, eq, events, nodeExecutions, projects, runs, sql, type Db } from "@handoff/db";
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

/** Runs that reached a Finish node with notify on in the last day, and that nobody has dismissed. */
async function finishedRuns(db: Db) {
  const dismissed = sql`exists (select 1 from events d where d.run_id = ${runs.id} and d.type = 'attention.dismissed')`;
  return db
    .select({ runId: runs.id, task: runs.task, projectName: projects.name })
    .from(events)
    .innerJoin(runs, eq(runs.id, events.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(eq(events.type, "run.finish"), sql`(${events.payload}->>'notify')::boolean`, sql`${events.createdAt} > now() - interval '1 day'`, sql`not ${dismissed}`))
    .orderBy(desc(events.createdAt));
}

/** Runs stopped because a loop used all its attempts: no step failed, so they need a decision rather than a repair. */
async function stuckRuns(db: Db) {
  const lastFailure = sql<{ reason?: string; nodeKey?: string } | null>`(
    select e.payload from events e where e.run_id = ${runs.id} and e.type = 'run.failed' order by e.seq desc limit 1
  )`;
  const rows = await db
    .select({ runId: runs.id, task: runs.task, projectName: projects.name, failure: lastFailure })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(eq(runs.status, "failed"));
  return rows.filter((r) => r.failure?.reason === "loop_exhausted");
}

const FINISHED = /^finished:([0-9a-f-]{36})$/i;

/**
 * Takes a finished run off what needs attention, as an event on that run. Only finished runs can be
 * dismissed: questions, failures and reviews leave the list when someone acts on them.
 */
export async function dismissAttention(db: Db, itemId: string) {
  const runId = FINISHED.exec(itemId)?.[1];
  if (!runId) throw new Error("Only finished runs can be dismissed; the other items leave the list once someone acts on them.");
  const [run] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error(`There is no run ${runId}.`);
  await db.transaction((tx) => appendEvents(tx, runId, [{ type: "attention.dismissed", payload: { itemId } }]));
}

/**
 * Everything that needs a person right now, one item per thing with a stable id, so the dashboard
 * can notify once per new item: open questions, failed runs awaiting repair, PRs waiting for review,
 * and runs that reached a Finish node with notify on, which need no action.
 */
export async function listAttention(db: Db): Promise<AttentionItem[]> {
  const [inbox, reviews, finished, stuck] = await Promise.all([listInbox(db), waitingReviews(db), finishedRuns(db), stuckRuns(db)]);
  return [
    ...inbox.questions.map((q): AttentionItem => {
      const review = (q.context as { review?: { from?: string; kind?: string } }).review;
      return review
        ? { id: `question:${q.id}`, kind: "question", title: `${q.projectName}: the ${review.kind} from ${review.from} needs your approval`, body: q.task, href: `/runs/${q.runId}/review/${q.id}` }
        : { id: `question:${q.id}`, kind: "question", title: `${q.projectName}: ${q.nodeKey} asks a question`, body: q.question, href: `/runs/${q.runId}` };
    }),
    ...inbox.failedRuns.map((f): AttentionItem => ({ id: `failed:${f.executionId}`, kind: "failed", title: `${f.projectName}: run failed at ${f.nodeKey}`, body: f.task, href: `/runs/${f.runId}` })),
    ...reviews.map((r): AttentionItem => ({
      id: `review:${r.executionId}:${r.pr!.number}`,
      kind: "review",
      title: `${r.projectName}: PR #${r.pr!.number} waits for your review`,
      body: r.task,
      href: `/runs/${r.runId}`,
    })),
    ...stuck.map((s): AttentionItem => ({
      id: `stuck:${s.runId}`,
      kind: "failed",
      title: `${s.projectName}: ${s.failure?.nodeKey ?? "a step"} ran out of rounds`,
      body: s.task,
      href: `/runs/${s.runId}`,
    })),
    ...finished.map((f): AttentionItem => ({ id: `finished:${f.runId}`, kind: "finished", title: `${f.projectName}: run finished`, body: f.task, href: `/runs/${f.runId}` })),
  ];
}
