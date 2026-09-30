import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { afterAll, beforeEach, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { liveWorkers, nodeExecutions } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { engineDeps, inspect, startRun } from "../testing/harness.ts";
import { killOrphans, startWorker } from "./worker.ts";

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
