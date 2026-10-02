import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { afterAll, beforeEach, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { eq, liveWorkers, nodeExecutions, previews } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { schedulerOn } from "../testing/scheduler.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";
import { killOrphans, runOnce, startWorker } from "./worker.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("startWorker registers the worker and stop marks it stopped", async () => {
  const handle = startWorker(engineDeps(db, {}, { workerId: "lifecycle-worker" }), { pollIntervalMs: 20, heartbeatMs: 20 });
  await new Promise((r) => setTimeout(r, 80));
  expect((await liveWorkers(db, 60_000)).map((w) => w.id)).toEqual(["lifecycle-worker"]);
  await handle.stop();
  expect(await liveWorkers(db, 60_000)).toEqual([]);
});

test("killOrphans stops a claude child left running by a previous worker on this host", async () => {
  const { run } = await startRun(db, linear);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "claude-orphan-test"], { detached: true, stdio: "ignore" });
  const [execution] = (await inspect(db, run.id)).executions;
  await db.$client.query(
    "update node_executions set status = 'running', lease_owner = 'crashed-worker', child_pid = $1, child_host = $2 where id = $3",
    [child.pid, hostname(), execution!.id],
  );
  const killed = await killOrphans(engineDeps(db, {}, { workerId: "new-worker" }));
  await new Promise((r) => setTimeout(r, 200));
  expect(killed).toEqual([execution!.id]);
  expect(alive(child.pid!)).toBe(false);
  const row = (await db.select().from(nodeExecutions))[0]!;
  expect(row.childPid).toBeNull();
});

test("killOrphans leaves processes that are not claude alone", async () => {
  const { run } = await startRun(db, linear);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  const [execution] = (await inspect(db, run.id)).executions;
  await db.$client.query("update node_executions set status = 'running', lease_owner = 'crashed-worker', child_pid = $1, child_host = $2 where id = $3", [
    child.pid,
    hostname(),
    execution!.id,
  ]);
  expect(await killOrphans(engineDeps(db, {}, { workerId: "new-worker" }))).toEqual([]);
  expect(alive(child.pid!)).toBe(true);
  process.kill(child.pid!, "SIGKILL");
});

test("a worker that starts again stops the previews it left running", async () => {
  const { run } = await seedRun(db);
  const app = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  const [row] = await db
    .insert(previews)
    .values({ runId: run.id, configuration: "web", workerId: "lifecycle-worker", status: "running", pid: app.pid!, port: 41000, url: "http://localhost:41000", logPath: "/tmp/x.log" })
    .returning();
  const handle = startWorker(engineDeps(db, {}, { workerId: "lifecycle-worker" }), { pollIntervalMs: 20, heartbeatMs: 20 });
  await expect.poll(async () => (await db.select({ status: previews.status }).from(previews).where(eq(previews.id, row!.id)))[0]!.status).toBe("stopped");
  await handle.stop();
  expect(alive(app.pid!)).toBe(false);
});

test("a run that ends nudges its project's scheduler", async () => {
  const executors = {
    planner: scripted(done(outputs.planner, { plan: outputs.planner })),
    coder: scripted(done(outputs.coderDone)),
    pr: scripted(done(outputs.prGreen, { prNumber: 1 })),
    merge: scripted(done({ merged: true })),
  };
  const succeeds = await startRun(db, linear);
  const scheduler = await schedulerOn(db, succeeds.project.id);
  const deps = engineDeps(db, executors);
  // A step that passes on the way does not end the run, and nudges nothing.
  await runOnce(deps);
  expect(await scheduler.due()).toBe(30);
  await drain(deps);
  expect((await inspect(db, succeeds.run.id)).run.status).toBe("succeeded");
  expect(await scheduler.due()).toBe(0);

  const fails = await startRun(db, linear);
  const failing = await schedulerOn(db, fails.project.id);
  await drain(engineDeps(db, { ...executors, planner: scripted({ kind: "failed", error: { code: "boom", message: "boom" } }) }));
  expect((await inspect(db, fails.run.id)).run.status).toBe("failed");
  expect(await failing.due()).toBe(0);
});
