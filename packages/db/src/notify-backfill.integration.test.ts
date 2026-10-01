import { readFileSync } from "node:fs";
import { afterAll, beforeEach, expect, test } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { appendEvents } from "./ops/events.ts";
import { events, questions, runs } from "./schema/index.ts";
import { createTestDb, seedExecution, seedRun, truncateAll } from "./testing/index.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const backfill = readFileSync(new URL("../drizzle/20261001122825_notify_events/migration.sql", import.meta.url), "utf8");
const notifications = async (runId: string) =>
  (await db.select({ seq: events.seq, payload: events.payload }).from(events).where(and(eq(events.runId, runId), eq(events.type, "notify"))).orderBy(asc(events.seq))).map((e) => e.payload);

test("earlier notifications become node notifications with the default settings, after the run's last event", async () => {
  const { run } = await seedRun(db);
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "passed" });
  const merge = await seedExecution(db, run.id, { nodeKey: "merge", nodeType: "merge", executorKind: "github", status: "waiting", attempt: 1 });
  await db.transaction((tx) =>
    appendEvents(tx, run.id, [
      { type: "run.started", payload: {} },
      { type: "merge.ready", payload: { number: 54 }, nodeExecutionId: merge.id },
      { type: "run.failed", payload: { nodeKey: "coder", reason: "node_failed" } },
      { type: "run.succeeded", payload: {} },
    ]),
  );
  const [question] = await db.insert(questions).values({ runId: run.id, nodeExecutionId: gate.id, question: "Which license?" }).returning();
  await db.execute(sql`update questions set created_at = now() + interval '1 minute'`);

  await db.execute(sql.raw(backfill));
  expect(await notifications(run.id)).toEqual([
    { kind: "ready", nodeKey: "merge", number: 54 },
    { kind: "failed", nodeKey: "coder", reason: "node_failed" },
    { kind: "finished" },
    { kind: "input", nodeKey: "gate", questionId: question!.id },
  ]);
  const [{ next }] = (await db.select({ next: runs.nextEventSeq }).from(runs).where(eq(runs.id, run.id))) as [{ next: number }];
  expect(next).toBe(8);
  const ready = (await db.select().from(events).where(eq(events.type, "notify")))[0]!;
  expect(ready.nodeExecutionId).toBe(merge.id);

  // Running it again adds nothing.
  await db.execute(sql.raw(backfill));
  expect(await notifications(run.id)).toHaveLength(4);
});

test("a run whose Finish node had notify off does not get a finished notification", async () => {
  const { run } = await seedRun(db);
  await db.transaction((tx) => appendEvents(tx, run.id, [{ type: "run.finish", payload: { notify: false } }, { type: "run.succeeded", payload: {} }]));
  await db.execute(sql.raw(backfill));
  expect(await notifications(run.id)).toEqual([]);
});
