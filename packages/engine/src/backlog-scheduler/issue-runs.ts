import { and, desc, eq, runs, schedulerEvents, type DbExecutor } from "@handoff/db";
import type { IssueRun } from "./candidates.ts";

const ACTIVE = ["queued", "running", "waiting"];
const isActive = (status: string) => ACTIVE.includes(status);

/** The run that counts for each issue of the project: its active run when it has one, else its latest run. */
export async function issueRuns(db: DbExecutor, projectId: string): Promise<Map<number, IssueRun>> {
  const rows = await db.select({ id: runs.id, status: runs.status, issues: runs.issues }).from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.createdAt));
  const result = new Map<number, IssueRun>();
  for (const run of rows) {
    for (const { number } of run.issues) {
      const known = result.get(number);
      if (!known || (isActive(run.status) && !isActive(known.status))) result.set(number, { id: run.id, status: run.status });
    }
  }
  return result;
}

/**
 * The cancelled runs whose task a person let the scheduler take again, from the project's
 * scheduler.released events. A release names the run it releases, so a later cancel needs a new one.
 */
export async function releasedRuns(db: DbExecutor, projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ payload: schedulerEvents.payload })
    .from(schedulerEvents)
    .where(and(eq(schedulerEvents.projectId, projectId), eq(schedulerEvents.type, "scheduler.released")));
  return new Set(rows.flatMap((r) => (typeof r.payload.runId === "string" ? [r.payload.runId] : [])));
}
