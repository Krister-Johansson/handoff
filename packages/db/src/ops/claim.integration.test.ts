import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { nodeExecutions } from "../schema/index.ts";
import { seedExecution, seedRun } from "../testing/fixtures.ts";
import { truncateAll } from "../testing/reset.ts";
import { createTestDb } from "../testing/test-db.ts";
import { claimNext, heartbeat, reapExpiredLeases, reapExpiredWaits, resumeAfterPermission, waitOnPermission, wakeByKey } from "./claim.ts";

const db = createTestDb();
const caps = { cli: 1, shell: 4, github: 4, human: 100, function: 8 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

describe("claimNext", () => {
  test("claimNext hands one pending node execution to exactly one of two concurrent workers", async () => {
    const { run } = await seedRun(db);
    await seedExecution(db, run.id);
    const [a, b] = await Promise.all([
      claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 }),
      claimNext(db, { workerId: "w2", caps, leaseMs: 60_000 }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const claimed = (a ?? b)!;
    expect(claimed.status).toBe("running");
    expect(claimed.leaseOwner).toMatch(/^w[12]$/);
    expect(claimed.claimedAt).not.toBeNull();
  });

  test("claimNext respects the cli concurrency cap across workers", async () => {
    const { run } = await seedRun(db);
    await seedExecution(db, run.id, { nodeKey: "a" });
    await seedExecution(db, run.id, { nodeKey: "b" });
    await seedExecution(db, run.id, { nodeKey: "t", nodeType: "tester", executorKind: "shell" });
    const first = await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 });
    const second = await claimNext(db, { workerId: "w2", caps, leaseMs: 60_000 });
    const third = await claimNext(db, { workerId: "w2", caps, leaseMs: 60_000 });
    expect(first?.executorKind).toBe("cli");
    expect(second?.executorKind).toBe("shell");
    expect(third).toBeUndefined();
  });

  test("claimNext does not return an execution before runnable_at", async () => {
    const { run } = await seedRun(db);
    await seedExecution(db, run.id, { runnableAt: new Date(Date.now() + 60_000) });
    expect(await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 })).toBeUndefined();
  });

  test("claiming adds the time since runnable_at to queued_ms, across a wait and a wake", async () => {
    const { run } = await seedRun(db);
    const row = await seedExecution(db, run.id);
    // On the database's clock, which may differ from this process's by a few milliseconds.
    await db.$client.query("update node_executions set runnable_at = now() - interval '5 seconds' where id = $1", [row.id]);
    const first = await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 });
    expect(first?.queuedMs).toBeGreaterThanOrEqual(5_000);
    expect(first?.queuedMs).toBeLessThan(6_000);

    // The step yields to wait for a pull request; an hour of waiting is not queue time.
    await db.$client.query(
      "update node_executions set status = 'waiting', wait_key = 'gh:pr:1:7', lease_owner = null, runnable_at = now() - interval '1 hour' where id = $1",
      [row.id],
    );
    await wakeByKey(db, "gh:pr:1:7", { reason: "webhook" });
    // Three seconds pass before a worker has room for it again.
    await db.$client.query("update node_executions set runnable_at = runnable_at - interval '3 seconds' where id = $1", [row.id]);
    const second = await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 });
    expect(second?.id).toBe(row.id);
    expect(second?.queuedMs).toBeGreaterThanOrEqual(8_000);
    expect(second?.queuedMs).toBeLessThan(9_000);
  });

  test("a retry's delay is not queue time", async () => {
    const { run } = await seedRun(db);
    // A retry after a rate limit: created a while ago, runnable once its delay ends.
    const row = await seedExecution(db, run.id, { status: "pending", attempt: 2, retryCount: 1 });
    await db.$client.query(
      "update node_executions set runnable_at = now() + interval '400 milliseconds', created_at = now() - interval '1 minute', updated_at = now() - interval '1 minute' where id = $1",
      [row.id],
    );
    expect(await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 })).toBeUndefined();
    await sleep(500);
    const claimed = await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 });
    expect(claimed?.id).toBe(row.id);
    expect(claimed?.queuedMs).toBeLessThan(400);
  });

  test("a step waiting on a permission prompt does not hold the Claude slot", async () => {
    const { run } = await seedRun(db);
    await seedExecution(db, run.id, { nodeKey: "planner", nodeType: "planner" });
    const asking = (await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 }))!;
    await seedExecution(db, run.id, { nodeKey: "coder" });
    expect(await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 })).toBeUndefined();

    await waitOnPermission(db, asking.id);
    const other = await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 });
    expect(other?.nodeKey).toBe("coder");

    // Answered while the other step runs, the asking step waits for the slot before its process goes on.
    expect(await resumeAfterPermission(db, asking.id, caps)).toBe(false);
    const [still] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.id, asking.id));
    expect(still?.waitingOn).toBe("permission");
    await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.id, other!.id));
    expect(await resumeAfterPermission(db, asking.id, caps)).toBe(true);
    const [resumed] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.id, asking.id));
    expect(resumed).toMatchObject({ status: "running", waitingOn: null });
  });

  test("claimNext skips executions of cancelled or finished runs", async () => {
    const { run } = await seedRun(db);
    await seedExecution(db, run.id);
    await db.$client.query("update runs set status = 'cancelled'");
    expect(await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 })).toBeUndefined();
  });
});

describe("wakeByKey", () => {
  test("wakeByKey makes a waiting execution claimable now", async () => {
    const { run } = await seedRun(db);
    await seedExecution(db, run.id, { status: "waiting", waitKind: "github_pr", waitKey: "gh:pr:1:7", runnableAt: new Date(Date.now() + 600_000) });
    const woken = await wakeByKey(db, "gh:pr:1:7", { reason: "webhook", payload: { deliveryId: "d1" } });
    expect(woken.woken).toHaveLength(1);
    const claimed = await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 });
    expect(claimed?.wakeReason).toBe("webhook");
    expect(claimed?.wakePayload).toEqual([{ deliveryId: "d1" }]);
  });

  test("wakeByKey marks a running execution so its yield returns it to pending", async () => {
    const { run } = await seedRun(db);
    const row = await seedExecution(db, run.id, { status: "running", waitKey: "gh:pr:1:7" });
    const result = await wakeByKey(db, "gh:pr:1:7", { reason: "webhook" });
    expect(result.flagged).toEqual([row.id]);
    const [after] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.id, row.id));
    expect(after?.status).toBe("running");
    expect(after?.wakeRequestedAt).not.toBeNull();
  });

  test("wakeByKey with no matching execution wakes nothing", async () => {
    expect(await wakeByKey(db, "gh:pr:9:9", { reason: "webhook" })).toEqual({ woken: [], flagged: [] });
  });
});

describe("leases", () => {
  test("heartbeat extends the lease while the worker still owns it", async () => {
    const { run } = await seedRun(db);
    await seedExecution(db, run.id);
    const claimed = (await claimNext(db, { workerId: "w1", caps, leaseMs: 1_000 }))!;
    expect(await heartbeat(db, claimed.id, "w1", 60_000)).toEqual({ alive: true, cancelRequested: false });
    expect(await heartbeat(db, claimed.id, "w2", 60_000)).toEqual({ alive: false, cancelRequested: false });
  });

  test("a running execution whose lease expires is returned to pending and can be claimed again", async () => {
    const { run } = await seedRun(db);
    await seedExecution(db, run.id);
    const claimed = (await claimNext(db, { workerId: "w1", caps, leaseMs: 5 }))!;
    await sleep(20);
    const reaped = await reapExpiredLeases(db, { maxReclaims: 2 });
    expect(reaped.reclaimed).toEqual([claimed.id]);
    const again = await claimNext(db, { workerId: "w2", caps, leaseMs: 60_000 });
    expect(again?.id).toBe(claimed.id);
    expect(again?.reclaimCount).toBe(1);
    expect(await heartbeat(db, claimed.id, "w1", 60_000)).toEqual({ alive: false, cancelRequested: false });
  });

  test("a reclaimed execution is failed on the second lease expiry", async () => {
    const { run } = await seedRun(db);
    await seedExecution(db, run.id, { reclaimCount: 1 });
    const claimed = (await claimNext(db, { workerId: "w1", caps, leaseMs: 5 }))!;
    await sleep(20);
    const reaped = await reapExpiredLeases(db, { maxReclaims: 2 });
    expect(reaped.failed).toEqual([claimed.id]);
    const [row] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.id, claimed.id));
    expect(row?.status).toBe("failed");
    expect(row?.error?.code).toBe("reclaim_limit");
  });

  test("a waiting execution past its deadline is woken with reason timeout", async () => {
    const { run } = await seedRun(db);
    const row = await seedExecution(db, run.id, { status: "waiting", waitDeadlineAt: new Date(Date.now() - 1000), runnableAt: new Date(Date.now() + 600_000) });
    expect(await reapExpiredWaits(db)).toEqual([row.id]);
    expect((await claimNext(db, { workerId: "w1", caps, leaseMs: 60_000 }))?.wakeReason).toBe("timeout");
  });
});
