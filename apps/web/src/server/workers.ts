import { eq, liveWorkers, runs, sql, type Db } from "@handoff/db";

/** A worker is live when it heartbeated in the last minute (heartbeats every 15 s). */
export async function workerSummary(db: Db) {
  const [workers, [queued]] = await Promise.all([
    liveWorkers(db, 60_000),
    db.select({ n: sql<number>`count(*)::int` }).from(runs).where(eq(runs.status, "queued")),
  ]);
  return { live: workers.length, queuedRuns: queued?.n ?? 0, workers: workers.map((w) => ({ id: w.id, hostname: w.hostname })) };
}
