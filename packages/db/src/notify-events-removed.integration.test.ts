import { readFileSync } from "node:fs";
import { afterAll, beforeEach, expect, test } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { appendEvents } from "./ops/events.ts";
import { events, runs } from "./schema/index.ts";
import { createTestDb, seedRun, truncateAll } from "./testing/index.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const removal = readFileSync(new URL("../drizzle/20261002123543_notify_events_removed/migration.sql", import.meta.url), "utf8");

test("the notify events are removed and a run's other events stay, with new events numbered after the old ones", async () => {
  const { run } = await seedRun(db);
  await db.transaction((tx) =>
    appendEvents(tx, run.id, [
      { type: "run.started", payload: {} },
      { type: "notify", payload: { kind: "started", title: "p: run started", body: "t" } },
      { type: "human.asked", payload: { questionId: "q" } },
      { type: "notify", payload: { kind: "input", title: "p: gate asks a question", body: "Which license?" } },
    ]),
  );

  await db.execute(sql.raw(removal));
  const left = () => db.select({ seq: events.seq, type: events.type }).from(events).where(eq(events.runId, run.id)).orderBy(asc(events.seq));
  expect(await left()).toEqual([
    { seq: 1, type: "run.started" },
    { seq: 3, type: "human.asked" },
  ]);

  await db.transaction((tx) => appendEvents(tx, run.id, [{ type: "run.succeeded", payload: {} }]));
  expect((await left()).at(-1)).toEqual({ seq: 5, type: "run.succeeded" });
  const [{ next }] = (await db.select({ next: runs.nextEventSeq }).from(runs).where(eq(runs.id, run.id))) as [{ next: number }];
  expect(next).toBe(5);
});
