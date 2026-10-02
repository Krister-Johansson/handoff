import { and, appendEvents, desc, eq, events, nodeExecutions, projects, runs, sql, type Db } from "@handoff/db";
import { brief, describePermission, questionBrief } from "@handoff/core";
import { reviewPath, runPath } from "../lib/paths";
import type { AttentionItem } from "../lib/attention";
import { listInbox } from "./inbox";
import { allPendingPermissions } from "./permissions";

/** Pull requests whose PR node still waits after CI finished, which only happens when it needs an approving review. */
export async function waitingReviews(db: Db) {
  const latestPr = sql<{ number?: number; url?: string; ci?: string } | null>`(
    select e.payload from events e
    where e.node_execution_id = ${nodeExecutions.id} and e.type = 'github.pr'
    order by e.seq desc limit 1
  )`;
  const rows = await db
    .select({
      executionId: nodeExecutions.id,
      runId: runs.id,
      projectId: runs.projectId,
      task: runs.task,
      projectName: projects.name,
      branch: runs.branchName,
      pr: latestPr,
    })
    .from(nodeExecutions)
    .innerJoin(runs, eq(runs.id, nodeExecutions.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(eq(nodeExecutions.status, "waiting"), eq(nodeExecutions.waitKind, "github_pr")));
  return rows.filter((r) => r.pr && r.pr.ci !== "pending" && r.pr.number !== undefined);
}

/** Runs that reached a Finish node with notify on in the last day, and that nobody has dismissed. */
async function finishedRuns(db: Db) {
  const dismissed = sql`exists (select 1 from events d where d.run_id = ${runs.id} and d.type = 'attention.dismissed' and d.payload->>'itemId' = 'finished:' || ${runs.id}::text)`;
  return db
    .select({ runId: runs.id, projectId: runs.projectId, task: runs.task, projectName: projects.name })
    .from(events)
    .innerJoin(runs, eq(runs.id, events.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(eq(events.type, "run.finish"), sql`(${events.payload}->>'notify')::boolean`, sql`${events.createdAt} > now() - interval '1 day'`, sql`not ${dismissed}`))
    .orderBy(desc(events.createdAt));
}

/** Runs stopped because a loop used all its attempts: no step failed, so they need a decision rather than a repair. */
export async function stuckRuns(db: Db) {
  const lastFailure = sql<{ reason?: string; nodeKey?: string } | null>`(
    select e.payload from events e where e.run_id = ${runs.id} and e.type = 'run.failed' order by e.seq desc limit 1
  )`;
  const rows = await db
    .select({ runId: runs.id, projectId: runs.projectId, task: runs.task, projectName: projects.name, finishedAt: runs.finishedAt, failure: lastFailure })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(eq(runs.status, "failed"));
  return rows.filter((r) => r.failure?.reason === "loop_exhausted");
}

/** Items a person can take off the list: a finished run, and a failed or stuck run they have seen and will come back to. */
const DISMISSABLE = /^(finished|failed|stuck):([0-9a-f-]{36})$/i;

/**
 * Takes a finished, failed or stuck run off what needs attention, as an event on that run. A failed run
 * still waits for a repair in the inbox; a new failure is a new item. Questions, permission prompts and
 * reviews leave the list when someone answers them.
 */
export async function dismissAttention(db: Db, itemId: string) {
  const match = DISMISSABLE.exec(itemId);
  if (!match) throw new Error("Only finished and failed runs can be dismissed; questions, permission prompts and reviews leave the list once someone answers them.");
  const [kind, id] = [match[1]!.toLowerCase(), match[2]!];
  const [run] =
    kind === "failed"
      ? await db.select({ id: nodeExecutions.runId }).from(nodeExecutions).where(eq(nodeExecutions.id, id))
      : await db.select({ id: runs.id }).from(runs).where(eq(runs.id, id));
  if (!run) throw new Error(`There is no ${kind === "failed" ? "step" : "run"} ${id}.`);
  await db.transaction((tx) => appendEvents(tx, run.id, [{ type: "attention.dismissed", payload: { itemId } }]));
}

/** The ids of failed and stuck items someone dismissed. */
async function dismissedItems(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: sql<string>`${events.payload}->>'itemId'` })
    .from(events)
    .innerJoin(runs, eq(runs.id, events.runId))
    .where(and(eq(events.type, "attention.dismissed"), eq(runs.status, "failed")));
  return new Set(rows.map((r) => r.itemId));
}

/**
 * Everything that needs a person right now, one item per thing with a stable id, so the dashboard
 * can notify once per new item: permission prompts, open questions, failed runs awaiting repair that
 * nobody dismissed, PRs waiting for review, and runs that reached a Finish node with notify on, which
 * need no action. Each item names its
 * project; with a project id, only that project's items.
 */
export async function listAttention(db: Db, opts: { projectId?: string } = {}): Promise<AttentionItem[]> {
  const [inbox, reviews, finished, stuck, permissions, dismissed] = await Promise.all([
    listInbox(db),
    waitingReviews(db),
    finishedRuns(db),
    stuckRuns(db),
    allPendingPermissions(db),
    dismissedItems(db),
  ]);
  const items = [
    ...permissions.map((p): AttentionItem => {
      const { action, detail } = describePermission(p.toolName, p.input);
      return { id: `permission:${p.id}`, kind: "permission", title: `${p.projectName}: ${p.nodeKey} ${action}`, body: brief(detail || p.task), href: runPath(p.projectId, p.runId), projectId: p.projectId };
    }),
    ...inbox.questions.map((q): AttentionItem => {
      const review = (q.context as { review?: { from?: string; kind?: string } }).review;
      return review
        ? { id: `question:${q.id}`, kind: "question", title: `${q.projectName}: the ${review.kind} from ${review.from} needs your approval`, body: brief(q.task), href: reviewPath(q.projectId, q.runId, q.id), projectId: q.projectId }
        : { id: `question:${q.id}`, kind: "question", title: `${q.projectName}: ${q.nodeKey} asks a question`, body: questionBrief(q.question, q.context), href: runPath(q.projectId, q.runId), projectId: q.projectId };
    }),
    ...inbox.failedRuns.map((f): AttentionItem => ({ id: `failed:${f.executionId}`, kind: "failed", title: `${f.projectName}: run failed at ${f.nodeKey}`, body: brief(f.task), href: runPath(f.projectId, f.runId), projectId: f.projectId })),
    ...reviews.map((r): AttentionItem => ({
      id: `review:${r.executionId}:${r.pr!.number}`,
      kind: "review",
      title: `${r.projectName}: PR #${r.pr!.number} waits for your review`,
      body: brief(r.task),
      href: runPath(r.projectId, r.runId),
      projectId: r.projectId,
    })),
    ...stuck.map((s): AttentionItem => ({
      id: `stuck:${s.runId}`,
      kind: "failed",
      title: `${s.projectName}: ${s.failure?.nodeKey ?? "a step"} ran out of rounds`,
      body: brief(s.task),
      href: runPath(s.projectId, s.runId),
      projectId: s.projectId,
    })),
    ...finished.map((f): AttentionItem => ({ id: `finished:${f.runId}`, kind: "finished", title: `${f.projectName}: run finished`, body: brief(f.task), href: runPath(f.projectId, f.runId), projectId: f.projectId })),
  ];
  const shown = items.filter((i) => !dismissed.has(i.id));
  return opts.projectId ? shown.filter((i) => i.projectId === opts.projectId) : shown;
}
