import { and, desc, eq, inArray, runs, sql, type Db } from "@handoff/db";
import { RUNS_FILTERS, type RunsFilter, type RunStatusName } from "@/lib/run-status-filter";

/** How many of a project's runs each Runs filter lists, and all of them. */
export type RunsCounts = Record<RunsFilter | "all", number>;

const STATUSES = Object.fromEntries(RUNS_FILTERS.map((f) => [f.value, f.statuses])) as Record<RunsFilter, RunStatusName[]>;

const count = (filter: RunsFilter) => sql<number>`(count(*) filter (where ${inArray(runs.status, STATUSES[filter])}))::int`;

/**
 * A project's runs for its Runs page, newest first: every run, or those of one filter, up to `limit`;
 * with the count of each filter over all the project's runs.
 */
export async function projectRuns(db: Db, projectId: string, filter?: RunsFilter, limit = 50) {
  const statuses = filter ? STATUSES[filter] : undefined;
  const [listed, [counts]] = await Promise.all([
    db
      .select()
      .from(runs)
      .where(and(eq(runs.projectId, projectId), statuses ? inArray(runs.status, statuses) : undefined))
      .orderBy(desc(runs.createdAt))
      .limit(limit),
    db
      .select({
        all: sql<number>`count(*)::int`,
        active: count("active"),
        waiting: count("waiting"),
        failed: count("failed"),
        done: count("done"),
      })
      .from(runs)
      .where(eq(runs.projectId, projectId)),
  ]);
  return { runs: listed, counts: counts! satisfies RunsCounts };
}
