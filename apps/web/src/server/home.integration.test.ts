import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projects, runs } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import { homeSummary } from "./home.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("homeSummary lists active runs newest first and counts recent outcomes", async () => {
  const { run: waiting } = await seedRun(db, { status: "waiting" });
  const { run: done } = await seedRun(db, { status: "running" });
  await db.update(runs).set({ status: "succeeded", finishedAt: new Date() }).where(eq(runs.id, done.id));
  const summary = await homeSummary(db);
  expect(summary.activeRuns.map((r) => r.id)).toEqual([waiting.id]);
  expect(summary.recent).toMatchObject({ succeeded: 1, failed: 0 });
});

test("homeSummary hides demo projects' runs unless asked", async () => {
  const { project, run } = await seedRun(db, { status: "running" });
  await db.update(projects).set({ isDemo: true }).where(eq(projects.id, project.id));
  expect((await homeSummary(db)).activeRuns).toEqual([]);
  expect((await homeSummary(db, { includeDemo: true })).activeRuns.map((r) => r.id)).toEqual([run.id]);
});
