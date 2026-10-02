import { afterAll, beforeEach, expect, test } from "vitest";
import { runs, type Db } from "@handoff/db";
import { createTestDb, seedExecution, seedRun, truncateAll } from "@handoff/db/testing";
import type { PlanSize } from "@handoff/github";
import { loadForecasts } from "./forecasts.ts";

const db: Db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** An instant `minutes` after 09:00 on 30 September 2026. */
const at = (minutes: number) => new Date(Date.UTC(2026, 8, 30, 9, minutes));

type Finished = {
  minutes: number;
  status?: "succeeded" | "failed" | "cancelled";
  issues?: number[];
  size?: PlanSize | null;
  proposal?: PlanSize;
};

/** A project with a way to add runs that ran from 09:00 for `minutes`. */
async function seeded() {
  const { project, run: first } = await seedRun(db);
  const finished = async ({ minutes, status = "succeeded", issues = [1], size = null, proposal }: Finished) => {
    const plan = proposal ? { plan: "p", steps: ["a"], ownedPaths: ["src/a.ts"], size: proposal } : undefined;
    const [run] = await db
      .insert(runs)
      .values({
        projectId: project.id,
        graphVersionId: first.graphVersionId,
        status,
        task: "t",
        state: { task: "t", loops: {}, nodes: {}, human: {}, ...(plan ? { plan } : {}) },
        baseBranch: "main",
        branchName: `handoff/t-${crypto.randomUUID()}`,
        issues: issues.map((number) => ({ number, title: `#${number}`, url: `https://github.com/o/r/issues/${number}` })),
        size,
        startedAt: at(0),
        finishedAt: at(minutes),
      })
      .returning();
    return run!;
  };
  return { project, finished };
}

const noSizes = () => undefined;

test("only succeeded runs of the size that link one task count", async () => {
  const { project, finished } = await seeded();
  for (const minutes of [40, 50, 60, 70, 80]) {
    const run = await finished({ minutes, size: "M" });
    await seedExecution(db, run.id, { costUsd: "2.500000" });
  }
  await finished({ minutes: 1000, size: "M", status: "failed" });
  await finished({ minutes: 1000, size: "M", status: "cancelled" });
  await finished({ minutes: 1000, size: "M", issues: [1, 2] });
  await finished({ minutes: 90, size: "L" });

  const { forecasts, capacity } = await loadForecasts(db, project.id, noSizes);
  expect(forecasts.M).toMatchObject({ source: "runs", minutes: 60, runs: 5, costUsd: 2.5 });
  expect(forecasts.L).toMatchObject({ source: "default", minutes: 120, runs: 1, measuredMinutes: 90 });
  expect(forecasts.S).toMatchObject({ source: "default", minutes: 30, runs: 0, measuredMinutes: null });
  expect(capacity).toBe(6);
});

test("a run without a recorded size counts under its planner's proposal, then its task's current size", async () => {
  const { project, finished } = await seeded();
  // Recorded M wins over the planner's S.
  await finished({ minutes: 10, size: "M", proposal: "S" });
  // No recorded size: the planner's S wins over the task's current L.
  await finished({ minutes: 20, issues: [7], proposal: "S" });
  // No recorded size and no proposal: the task's current L.
  await finished({ minutes: 30, issues: [7] });
  // Neither, and the task has no size now: left out.
  await finished({ minutes: 40, issues: [8] });

  const { forecasts } = await loadForecasts(db, project.id, (issue) => (issue === 7 ? "L" : undefined));
  expect([forecasts.S.runs, forecasts.S.measuredMinutes]).toEqual([1, 20]);
  expect([forecasts.M.runs, forecasts.M.measuredMinutes]).toEqual([1, 10]);
  expect([forecasts.L.runs, forecasts.L.measuredMinutes]).toEqual([1, 30]);
});

test("queue time falls back to claimed minus runnable for executions without queued_ms", async () => {
  const { project, finished } = await seeded();
  for (let i = 0; i < 5; i++) {
    const run = await finished({ minutes: 60, size: "S" });
    // From before queued_ms: created 5 minutes before the run started and claimed when it started, so none of it is inside the run.
    await seedExecution(db, run.id, { nodeKey: "plan", createdAt: at(-5), runnableAt: at(-5), claimedAt: at(0) });
    // From before queued_ms: ready at 09:10 and claimed at 09:20, 10 minutes.
    await seedExecution(db, run.id, { nodeKey: "code", createdAt: at(5), runnableAt: at(10), claimedAt: at(20) });
    // After the migration: 6 minutes over its claims, whatever its last stretch says.
    await seedExecution(db, run.id, { nodeKey: "review", createdAt: at(30), runnableAt: at(45), claimedAt: at(46), queuedMs: 6 * 60_000 });
  }

  const { forecasts } = await loadForecasts(db, project.id, noSizes);
  expect(forecasts.S).toMatchObject({ source: "runs", minutes: 60, parts: { agent: 44, queue: 16, waiting: 0 } });
});
