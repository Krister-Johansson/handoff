import { and, desc, eq, events, sql, type Db } from "@handoff/db";

/** One execution's Claude CLI events, oldest first: the latest `limit` of them when there are more. */
export async function listExecutionCliEvents(db: Db, runId: string, executionId: string, limit = 3_000) {
  const rows = await db
    .select({ seq: events.seq, type: events.type, payload: events.payload, nodeExecutionId: events.nodeExecutionId, createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.runId, runId), eq(events.nodeExecutionId, executionId), sql`${events.type} like 'cli.%'`))
    .orderBy(desc(events.seq))
    .limit(limit);
  return rows.reverse().map((r) => ({ ...r, seq: Number(r.seq), createdAt: r.createdAt.toISOString() }));
}
