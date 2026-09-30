import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projects, runs } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import { listRuns } from "./queries.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function seed() {
  const { project: alpha, run: waiting } = await seedRun(db, { status: "waiting" });
  const { project: beta, run: failed } = await seedRun(db, { status: "running" });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, failed.id));
  const { run: succeeded } = await seedRun(db, { status: "running" });
  await db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, succeeded.id));
  await db.update(projects).set({ name: "alpha" }).where(eq(projects.id, alpha.id));
  await db.update(projects).set({ name: "beta" }).where(eq(projects.id, beta.id));
  return { waiting, failed, succeeded };
}

test("listRuns without a filter lists every run", async () => {
  await seed();
  expect(await listRuns(db)).toHaveLength(3);
});

test("listRuns with status active lists queued, running and waiting runs", async () => {
  const { waiting } = await seed();
  expect((await listRuns(db, { status: "active" })).map((r) => r.id)).toEqual([waiting.id]);
});

test("listRuns filters by a finished status", async () => {
  const { failed } = await seed();
  expect((await listRuns(db, { status: "failed" })).map((r) => r.id)).toEqual([failed.id]);
});

test("listRuns filters by project name and combines with status", async () => {
  const { failed } = await seed();
  expect((await listRuns(db, { project: "beta" })).map((r) => r.id)).toEqual([failed.id]);
  expect(await listRuns(db, { project: "beta", status: "succeeded" })).toEqual([]);
});
