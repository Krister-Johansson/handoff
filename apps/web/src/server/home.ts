import { and, desc, eq, gt, inArray, projects, runs, sql, type Db } from "@handoff/db";

export async function homeSummary(db: Db, opts: { includeDemo?: boolean } = {}) {
  const visible = opts.includeDemo ? undefined : eq(projects.isDemo, false);
  const [activeRuns, recentRows] = await Promise.all([
    db
      .select({ id: runs.id, projectId: runs.projectId, task: runs.task, status: runs.status, project: projects.name, prNumber: runs.prNumber, createdAt: runs.createdAt })
      .from(runs)
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .where(and(inArray(runs.status, ["queued", "running", "waiting"]), visible))
      .orderBy(desc(runs.createdAt))
      .limit(10),
    db
      .select({ status: runs.status, n: sql<number>`count(*)::int` })
      .from(runs)
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .where(and(gt(runs.finishedAt, sql`now() - interval '7 days'`), visible))
      .groupBy(runs.status),
  ]);
  const count = (status: string) => recentRows.find((r) => r.status === status)?.n ?? 0;
  return { activeRuns, recent: { succeeded: count("succeeded"), failed: count("failed"), cancelled: count("cancelled") } };
}
