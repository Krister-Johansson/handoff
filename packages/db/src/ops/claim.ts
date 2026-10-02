import { eq, sql } from "drizzle-orm";
import type { Db, DbExecutor } from "../client.ts";
import { nodeExecutions } from "../schema/index.ts";

export type ExecutorKind = (typeof nodeExecutions.executorKind.enumValues)[number];
export type NodeExecutionRow = typeof nodeExecutions.$inferSelect;
export type Caps = Record<ExecutorKind, number>;

const CLAIM_LOCK = sql`select pg_advisory_xact_lock(hashtext('handoff.claim'))`;

/**
 * Claims the next runnable execution whose executor kind has free capacity. The advisory lock
 * serialises claims so per-kind caps hold across workers; SKIP LOCKED skips rows held elsewhere.
 * The lease lives in columns; no transaction is held while the node runs.
 */
export async function claimNext(
  db: Db,
  opts: { workerId: string; caps: Caps; leaseMs: number },
): Promise<NodeExecutionRow | undefined> {
  return db.transaction(async (tx) => {
    await tx.execute(CLAIM_LOCK);
    const running = await tx.execute<{ executor_kind: ExecutorKind; n: number }>(
      sql`select executor_kind, count(*)::int as n from node_executions where status = 'running' group by executor_kind`,
    );
    const inUse = new Map(running.rows.map((r) => [r.executor_kind, r.n]));
    const free = (Object.keys(opts.caps) as ExecutorKind[]).filter((k) => opts.caps[k] - (inUse.get(k) ?? 0) > 0);
    if (free.length === 0) return undefined;

    const candidate = await tx.execute<{ id: string }>(sql`
      select ne.id from node_executions ne
      join runs r on r.id = ne.run_id
      where ne.status = 'pending'
        and ne.runnable_at <= now()
        and ne.executor_kind in (${sql.join(
          free.map((k) => sql`${k}`),
          sql`, `,
        )})
        and r.status in ('queued', 'running', 'waiting')
      order by ne.runnable_at, ne.created_at
      limit 1
      for update of ne skip locked`);
    const id = candidate.rows[0]?.id;
    if (!id) return undefined;

    const [row] = await tx
      .update(nodeExecutions)
      .set({
        status: "running",
        leaseOwner: opts.workerId,
        leaseExpiresAt: sql`now() + (${opts.leaseMs}::int * interval '1 millisecond')`,
        heartbeatAt: sql`now()`,
        claimedAt: sql`now()`,
        // A retry's runnable_at is the end of its delay, so the delay is not queue time.
        queuedMs: sql`${nodeExecutions.queuedMs} + greatest(0, floor(extract(epoch from now() - ${nodeExecutions.runnableAt}) * 1000))::int`,
        startedAt: sql`coalesce(${nodeExecutions.startedAt}, now())`,
      })
      .where(eq(nodeExecutions.id, id))
      .returning();
    return row;
  });
}

/** Extends the lease if this worker still owns the running execution. Also reports run cancellation. */
export async function heartbeat(
  db: DbExecutor,
  executionId: string,
  workerId: string,
  leaseMs: number,
): Promise<{ alive: boolean; cancelRequested: boolean }> {
  const result = await db.execute<{ cancel_requested: boolean }>(sql`
    update node_executions ne
    set lease_expires_at = now() + (${leaseMs}::int * interval '1 millisecond'), heartbeat_at = now()
    from runs r
    where ne.id = ${executionId} and ne.lease_owner = ${workerId} and ne.status = 'running' and r.id = ne.run_id
    returning (r.cancel_requested_at is not null) as cancel_requested`);
  const row = result.rows[0];
  return { alive: row !== undefined, cancelRequested: row?.cancel_requested ?? false };
}

export type WakeOptions = { reason: string; payload?: unknown };

/**
 * Wakes executions waiting on a correlation key. A waiting execution becomes pending now; a running
 * one only gets wake_requested_at, so its yield returns it straight to pending and no wake is lost.
 */
export async function wakeByKey(db: DbExecutor, key: string, opts: WakeOptions): Promise<{ woken: string[]; flagged: string[] }> {
  const payload = JSON.stringify(opts.payload === undefined ? [] : [opts.payload]);
  const result = await db.execute<{ id: string; was: string }>(sql`
    update node_executions
    set status = case when status = 'waiting' then 'pending'::node_execution_status else status end,
        runnable_at = case when status = 'waiting' then now() else runnable_at end,
        wake_requested_at = now(),
        wake_reason = ${opts.reason},
        wake_payload = coalesce(wake_payload, '[]'::jsonb) || ${payload}::jsonb
    where wait_key = ${key} and status in ('waiting', 'running')
    returning id, (case when status = 'pending' then 'waiting' else 'running' end) as was`);
  return {
    woken: result.rows.filter((r) => r.was === "waiting").map((r) => r.id),
    flagged: result.rows.filter((r) => r.was === "running").map((r) => r.id),
  };
}

/** Same as wakeByKey for a human gate's one-time token. Returns the woken id, or undefined if already answered. */
export async function wakeByToken(db: DbExecutor, token: string, opts: WakeOptions): Promise<string | undefined> {
  const payload = JSON.stringify(opts.payload === undefined ? [] : [opts.payload]);
  const result = await db.execute<{ id: string }>(sql`
    update node_executions
    set status = 'pending', runnable_at = now(), wake_requested_at = now(), wake_reason = ${opts.reason},
        wake_payload = coalesce(wake_payload, '[]'::jsonb) || ${payload}::jsonb
    where wait_token = ${token} and status = 'waiting'
    returning id`);
  return result.rows[0]?.id;
}

/** Returns expired leases to pending, or fails them once they reach maxReclaims. */
export async function reapExpiredLeases(db: DbExecutor, opts: { maxReclaims: number }): Promise<{ reclaimed: string[]; failed: string[] }> {
  const result = await db.execute<{ id: string; status: string }>(sql`
    with expired as (
      select id from node_executions
      where status = 'running' and lease_expires_at < now()
      for update skip locked
    )
    update node_executions ne
    set reclaim_count = ne.reclaim_count + 1,
        status = (case when ne.reclaim_count + 1 >= ${opts.maxReclaims} then 'failed' else 'pending' end)::node_execution_status,
        error = case when ne.reclaim_count + 1 >= ${opts.maxReclaims}
          then jsonb_build_object('code', 'reclaim_limit', 'message', 'lease expired too many times') else ne.error end,
        finished_at = case when ne.reclaim_count + 1 >= ${opts.maxReclaims} then now() else ne.finished_at end,
        lease_owner = null,
        lease_expires_at = null,
        runnable_at = now()
    from expired
    where ne.id = expired.id
    returning ne.id, ne.status`);
  return {
    reclaimed: result.rows.filter((r) => r.status === "pending").map((r) => r.id),
    failed: result.rows.filter((r) => r.status === "failed").map((r) => r.id),
  };
}

/** Wakes waiting executions whose wait deadline passed, with reason "timeout". */
export async function reapExpiredWaits(db: DbExecutor): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    update node_executions
    set status = 'pending', runnable_at = now(), wake_requested_at = now(), wake_reason = 'timeout'
    where status = 'waiting' and wait_deadline_at < now()
    returning id`);
  return result.rows.map((r) => r.id);
}
