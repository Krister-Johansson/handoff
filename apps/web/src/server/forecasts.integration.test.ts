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
