import { afterAll, beforeEach, expect, test } from "vitest";
import { registerWorker } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import { workerSummary } from "./workers.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("workerSummary counts live workers and runs waiting for one", async () => {
  await seedRun(db, { status: "queued" });
  expect(await workerSummary(db)).toEqual({ live: 0, queuedRuns: 1, workers: [] });
  await registerWorker(db, { id: "w1", hostname: "mac", caps: { cli: 1 } });
  expect(await workerSummary(db)).toMatchObject({ live: 1, queuedRuns: 1, workers: [{ id: "w1", hostname: "mac" }] });
});
