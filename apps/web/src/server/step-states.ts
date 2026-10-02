import { inArray, liveWorkers, nodeExecutions, sql, type DbExecutor } from "@handoff/db";

/** What a waiting step waits on: a person (permission or question), GitHub (ci), the merge queue, the worker, or another run's paths (overlap). */
export type WaitingOn = "permission" | "question" | "ci" | "merge_queue" | "worker" | "overlap";

/**
 * Where a step stands now. queued: ready, and `place` steps of its kind are ahead of it in the claim
 * order, counting itself (1 is next). running: its process works. waiting: on what `waiting_on` says.
 */
export type StepState = { state: "queued" | "running" | "waiting"; place?: number; waiting_on?: WaitingOn };

/** A worker that has not heartbeated for this long is not running. */
const WORKER_WINDOW_MS = 60_000;

const WAIT_KINDS: Record<string, WaitingOn> = { human: "question", github_pr: "ci", merge_queue: "merge_queue", timer: "overlap" };

/**
 * Each unfinished execution's state, by id; a step that passed or failed has none. A pending step's place follows the worker's claim order (runnable_at,
 * then created_at) among ready steps of the same executor kind on active runs. With no live worker, a
 * pending step waits on the worker.
 */
export async function stepStates(db: DbExecutor, executionIds: string[]): Promise<Map<string, StepState>> {
  const states = new Map<string, StepState>();
  if (executionIds.length === 0) return states;
  const [rows, places, workers] = await Promise.all([
    db
      .select({ id: nodeExecutions.id, status: nodeExecutions.status, waitingOn: nodeExecutions.waitingOn, waitKind: nodeExecutions.waitKind })
      .from(nodeExecutions)
      .where(inArray(nodeExecutions.id, executionIds)),
    db.execute<{ id: string; place: number }>(sql`
      select id, place from (
        select ne.id, row_number() over (partition by ne.executor_kind order by ne.runnable_at, ne.created_at)::int as place
        from node_executions ne join runs r on r.id = ne.run_id
        where ne.status = 'pending' and ne.runnable_at <= now() and r.status in ('queued', 'running', 'waiting')
      ) ranked
      where id in (${sql.join(
        executionIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`),
    liveWorkers(db, WORKER_WINDOW_MS),
  ]);
  const placeOf = new Map(places.rows.map((r) => [r.id, r.place]));
  for (const row of rows) {
    const place = placeOf.get(row.id);
    if (row.status === "pending") {
      // A step that waits out a retry delay has no place yet.
      const queued = place === undefined ? {} : { place };
      states.set(row.id, workers.length ? { state: "queued", ...queued } : { state: "waiting", waiting_on: "worker", ...queued });
    } else if (row.status === "running") {
      states.set(row.id, row.waitingOn === "permission" ? { state: "waiting", waiting_on: "permission" } : { state: "running" });
    } else if (row.status === "waiting") {
      const on = row.waitKind ? WAIT_KINDS[row.waitKind] : undefined;
      states.set(row.id, on ? { state: "waiting", waiting_on: on } : { state: "waiting" });
    }
  }
  return states;
}
