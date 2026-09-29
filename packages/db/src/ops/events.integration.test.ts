import { afterAll, beforeEach, expect, test } from "vitest";
import { seedRun } from "../testing/fixtures.ts";
import { truncateAll } from "../testing/reset.ts";
import { createTestDb } from "../testing/test-db.ts";
import { appendEvents, listEventsAfter } from "./events.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("appendEvents allocates gap-free per-run sequence numbers under concurrency", async () => {
  const { run } = await seedRun(db);
  const { run: other } = await seedRun(db);
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      db.transaction((tx) => appendEvents(tx, i % 4 === 0 ? other.id : run.id, [{ type: "t", payload: { i } }, { type: "t", payload: { i } }])),
    ),
  );
  const events = await listEventsAfter(db, run.id, 0, 1000);
  expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  expect((await listEventsAfter(db, other.id, 0, 1000)).map((e) => e.seq)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
});

test("listEventsAfter returns only events after the cursor, in order, up to the limit", async () => {
  const { run } = await seedRun(db);
  await db.transaction((tx) => appendEvents(tx, run.id, Array.from({ length: 5 }, (_, i) => ({ type: `e${i}`, payload: {} }))));
  const page = await listEventsAfter(db, run.id, 2, 2);
  expect(page.map((e) => [e.seq, e.type])).toEqual([
    [3, "e2"],
    [4, "e3"],
  ]);
});
