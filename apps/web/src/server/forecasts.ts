import { and, eq, inArray, isNotNull, nodeExecutions, permissionRequests, projects, questions, runs, sql, type Db } from "@handoff/db";
import { PLAN_SIZES, sizeOf, type PlanSize } from "@handoff/github";
import { forecastOf, runParts, type ForecastSample, type Forecasts } from "../lib/plan/forecast.ts";

export type ProjectForecasts = {
  forecasts: Forecasts;
  /** The person's hours of work a day on the plan. */
  capacity: number;
};

/**
 * The forecast of each size from the project's succeeded runs that link exactly one task, and the project's
 * capacity. Computed on every read; nothing of it is stored.
 */
export async function loadForecasts(db: Db, projectId: string, sizeOfIssue: (issue: number) => PlanSize | undefined): Promise<ProjectForecasts> {
  const [project] = await db.select({ capacity: projects.planHoursPerDay }).from(projects).where(eq(projects.id, projectId));
  const finished = await db
    .select({
      id: runs.id,
      size: runs.size,
      proposal: sql<string | null>`${runs.state}->'plan'->>'size'`,
      issue: sql<number>`(${runs.issues}->0->>'number')::int`,
      startedAt: runs.startedAt, finishedAt: runs.finishedAt, mergeQueuedAt: runs.mergeQueuedAt, mergeRequestedAt: runs.mergeRequestedAt })
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        eq(runs.status, "succeeded"),
        isNotNull(runs.startedAt),
        isNotNull(runs.finishedAt),
        sql`jsonb_array_length(${runs.issues}) = 1`,
      ),
    );
  const ids = finished.map((r) => r.id);
  const [asked, requested, executions] = ids.length
    ? await Promise.all([
        db.select({ runId: questions.runId, createdAt: questions.createdAt, answeredAt: questions.answeredAt }).from(questions).where(inArray(questions.runId, ids)),
        db
          .select({ runId: permissionRequests.runId, createdAt: permissionRequests.createdAt, decidedAt: permissionRequests.decidedAt })
          .from(permissionRequests)
          .where(inArray(permissionRequests.runId, ids)),
        db
          .select({
            runId: nodeExecutions.runId,
            createdAt: nodeExecutions.createdAt,
            runnableAt: nodeExecutions.runnableAt,
            claimedAt: nodeExecutions.claimedAt,
            queuedMs: nodeExecutions.queuedMs,
            costUsd: nodeExecutions.costUsd,
          })
          .from(nodeExecutions)
          .where(inArray(nodeExecutions.runId, ids)),
      ])
    : [[], [], []];
  const byRun = <T extends { runId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(row.runId, [...(map.get(row.runId) ?? []), row]);
    return map;
  };
  const questionsOf = byRun(asked);
  const permissionsOf = byRun(requested);
  const executionsOf = byRun(executions.map((e) => ({ ...e, costUsd: e.costUsd === null ? null : Number(e.costUsd) })));

  const samples: Record<PlanSize, ForecastSample[]> = { S: [], M: [], L: [] };
  for (const run of finished) {
    // The size the task had when the run started; a run from before that was recorded counts under its
    // planner's proposal, then under its task's current Size, so sizing finished tasks seeds the forecasts.
    const size = run.size ?? sizeOf(run.proposal) ?? sizeOfIssue(run.issue);
    if (!size) continue;
    const steps = executionsOf.get(run.id) ?? [];
    const parts = runParts(
      { startedAt: run.startedAt!, finishedAt: run.finishedAt!, mergeQueuedAt: run.mergeQueuedAt, mergeRequestedAt: run.mergeRequestedAt },
      questionsOf.get(run.id) ?? [],
      permissionsOf.get(run.id) ?? [],
      steps,
    );
    samples[size].push({ ...parts, costUsd: steps.reduce((sum, e) => sum + (e.costUsd ?? 0), 0) });
  }
  const forecasts = Object.fromEntries(PLAN_SIZES.map((size) => [size, forecastOf(samples[size], size)])) as Forecasts;
  return { forecasts, capacity: project?.capacity ?? 6 };
}
