import { afterAll, beforeEach, expect, test } from "vitest";
import { truncateAll } from "../testing/reset.ts";
import { createTestDb } from "../testing/test-db.ts";
import { heartbeatWorker, liveWorkers, registerWorker, stopWorker } from "./workers.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("a registered worker is live until it stops or its heartbeat goes stale", async () => {
  await registerWorker(db, { id: "w1", hostname: "mac", caps: { cli: 1 } });
  expect((await liveWorkers(db, 60_000)).map((w) => w.id)).toEqual(["w1"]);
  await heartbeatWorker(db, "w1");
  await stopWorker(db, "w1");
  expect(await liveWorkers(db, 60_000)).toEqual([]);
});

test("a worker whose heartbeat is older than the window is not live", async () => {
  await registerWorker(db, { id: "w1", hostname: "mac", caps: { cli: 1 } });
  await db.$client.query("update workers set heartbeat_at = now() - interval '5 minutes'");
  expect(await liveWorkers(db, 60_000)).toEqual([]);
});

test("registering again with the same id revives the worker", async () => {
  await registerWorker(db, { id: "w1", hostname: "mac", caps: { cli: 1 } });
  await stopWorker(db, "w1");
  await registerWorker(db, { id: "w1", hostname: "mac", caps: { cli: 2 } });
  expect(await liveWorkers(db, 60_000)).toEqual([expect.objectContaining({ id: "w1", caps: { cli: 2 } })]);
});
