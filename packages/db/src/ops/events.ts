import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { DbExecutor, DbTx } from "../client.ts";
import { events, runs } from "../schema/index.ts";

export type NewEvent = { type: string; payload: unknown; nodeExecutionId?: string | null };
export type EventRow = typeof events.$inferSelect;

/**
 * Appends events with gap-free per-run sequence numbers. Must run inside a transaction: the run row
 * stays locked until commit, so a reader never observes seq k before seq k-1 is visible.
 */
export async function appendEvents(tx: DbTx, runId: string, rows: NewEvent[]): Promise<EventRow[]> {
  if (rows.length === 0) return [];
  const [counter] = await tx
    .update(runs)
    .set({ nextEventSeq: sql`${runs.nextEventSeq} + ${rows.length}` })
    .where(eq(runs.id, runId))
    .returning({ next: runs.nextEventSeq });
  if (!counter) throw new Error(`run ${runId} not found`);
  const first = counter.next - rows.length + 1;
  return tx
    .insert(events)
    .values(
      rows.map((row, i) => ({
        runId,
        seq: first + i,
        type: row.type,
        payload: row.payload ?? {},
        nodeExecutionId: row.nodeExecutionId ?? null,
      })),
    )
    .returning();
}

export async function listEventsAfter(db: DbExecutor, runId: string, afterSeq: number, limit: number): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(and(eq(events.runId, runId), gt(events.seq, afterSeq)))
    .orderBy(asc(events.seq))
    .limit(limit);
}
