import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { runs, wakeByKey, type Db } from "@handoff/db";

/**
 * A project's merge queue: runs whose pull request is ready, in the order they became ready. Only the
 * first may merge, so each merge lands on top of the one before it. A manual merge also waits for a
 * person to ask; an auto merge does not.
 */

const ACTIVE = ["queued", "running", "waiting"] as const;

/** The wait key every run in a project's queue waits on; waking it lets each check its turn again. */
export const queueKey = (projectId: string) => `mq:${projectId}`;

export type QueueEntry = {
  runId: string;
  task: string;
  prNumber: number | null;
  issues: { number: number; title: string; url: string }[];
  queuedAt: Date;
  /** A person asked to merge it. */
  requested: boolean;
  /** 1 for the run whose turn it is. */
  position: number;
  /** Its merge step is waiting in the queue, rather than catching up with main or re-running CI. */
  waiting: boolean;
};

export async function mergeQueue(db: Db, projectId: string): Promise<QueueEntry[]> {
  const rows = await db
    .select({
      runId: runs.id,
      task: runs.task,
      prNumber: runs.prNumber,
      issues: runs.issues,
      queuedAt: runs.mergeQueuedAt,
      requestedAt: runs.mergeRequestedAt,
      // Columns spelled out: inside the subquery a bare "id" would be the execution's.
      waiting: sql<boolean>`exists (select 1 from node_executions ne where ne.run_id = "runs"."id" and ne.wait_kind = 'merge_queue' and ne.status = 'waiting')`,
    })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), isNotNull(runs.mergeQueuedAt), inArray(runs.status, [...ACTIVE])))
    .orderBy(asc(runs.mergeQueuedAt), asc(runs.id));
  return rows.map((r, i) => ({ runId: r.runId, task: r.task, prNumber: r.prNumber, issues: r.issues, queuedAt: r.queuedAt!, requested: r.requestedAt !== null, position: i + 1, waiting: r.waiting }));
}

/** Puts the run at the back of its project's queue, unless it already has a place. */
export async function joinQueue(db: Db, runId: string) {
  await db.update(runs).set({ mergeQueuedAt: sql`coalesce(${runs.mergeQueuedAt}, now())` }).where(eq(runs.id, runId));
}

/** Takes the run out of the queue, for example when it goes back to the coder, and lets the next one check its turn. */
export async function leaveQueue(db: Db, runId: string, projectId: string) {
  await db.update(runs).set({ mergeQueuedAt: null, mergeRequestedAt: null }).where(eq(runs.id, runId));
  await wakeQueue(db, projectId);
}

export async function wakeQueue(db: Db, projectId: string) {
  await wakeByKey(db, queueKey(projectId), { reason: "merge_queue" });
}

/** Where the run stands in its project's queue, and whether a person asked to merge it. */
export async function queueTurn(db: Db, runId: string, projectId: string) {
  const entries = await mergeQueue(db, projectId);
  const entry = entries.find((e) => e.runId === runId);
  return { position: entry?.position ?? entries.length + 1, requested: entry?.requested ?? false };
}

/** A person asks to merge one run's pull request; it merges when it is first in its project's queue. */
export async function requestMerge(db: Db, runId: string) {
  const [run] = await db
    .update(runs)
    .set({ mergeRequestedAt: sql`coalesce(${runs.mergeRequestedAt}, now())` })
    .where(and(eq(runs.id, runId), isNotNull(runs.mergeQueuedAt), inArray(runs.status, [...ACTIVE])))
    .returning({ projectId: runs.projectId });
  if (!run) throw new Error("That run has no pull request waiting to merge.");
  await wakeQueue(db, run.projectId);
}

/** A person asks to merge everything in the project's queue; it lands one pull request at a time, in order. */
export async function requestMergeAll(db: Db, projectId: string) {
  await db
    .update(runs)
    .set({ mergeRequestedAt: sql`coalesce(${runs.mergeRequestedAt}, now())` })
    .where(and(eq(runs.projectId, projectId), isNotNull(runs.mergeQueuedAt), inArray(runs.status, [...ACTIVE])));
  await wakeQueue(db, projectId);
}
