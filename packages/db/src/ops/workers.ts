import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { workers } from "../schema/index.ts";

export async function registerWorker(db: DbExecutor, input: { id: string; hostname: string; caps: Record<string, number> }) {
  await db
    .insert(workers)
    .values({ id: input.id, hostname: input.hostname, caps: input.caps })
    .onConflictDoUpdate({
      target: workers.id,
      set: { hostname: input.hostname, caps: input.caps, startedAt: sql`now()`, heartbeatAt: sql`now()`, stoppedAt: null },
    });
}

export async function heartbeatWorker(db: DbExecutor, id: string) {
  await db.update(workers).set({ heartbeatAt: sql`now()` }).where(eq(workers.id, id));
}

export async function stopWorker(db: DbExecutor, id: string) {
  await db.update(workers).set({ stoppedAt: sql`now()` }).where(eq(workers.id, id));
}

/** Workers that have not stopped and heartbeated within the window. */
export async function liveWorkers(db: DbExecutor, windowMs: number) {
  return db
    .select()
    .from(workers)
    .where(and(isNull(workers.stoppedAt), gt(workers.heartbeatAt, sql`now() - (${windowMs}::int * interval '1 millisecond')`)));
}
