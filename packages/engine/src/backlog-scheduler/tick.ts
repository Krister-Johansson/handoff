import { and, desc, eq, inArray, projects, projectSchedulers, runs, schedulerEvents, sql, type Db, type DbExecutor, type ProjectSchedulerRow } from "@handoff/db";
import type { GitHubPort, ProjectsPort } from "@handoff/github";
import { startRun } from "../start-run.ts";
import { candidates, type Candidate, type IssueRun, type Skipped } from "./candidates.ts";

export type CheckDeps = {
  db: Db;
  github: GitHubPort;
  projects: ProjectsPort;
  /** Who checks: the worker's id. */
  owner: string;
};

/** What a check found, kept on the scheduler's row for the status reads. */
export type CheckResult = {
  state: "full" | "idle" | "running";
  active: number;
  maxRuns: number;
  started: { runId: string; issue: number }[];
  candidates: Candidate[];
  skipped: Skipped[];
};

const ACTIVE = ["queued", "running", "waiting"] as const;
const CHECK_EVERY = "60 seconds";

/**
 * One check of a project's scheduler: counts the project's active runs, reads the plan once when
 * a slot is free, and starts the first candidate with the scheduler's graph. It records what it
 * found on the row and what it did as scheduler events.
 */
export async function checkProject(deps: CheckDeps, projectId: string): Promise<CheckResult | undefined> {
  const { db } = deps;
  const [row] = await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId));
  if (!row || !row.enabled || row.pausedAt) return undefined;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return undefined;
  const active = await activeRuns(db, projectId);
  const result: CheckResult = { state: "full", active, maxRuns: row.maxRuns, started: [], candidates: [], skipped: [] };
  if (active < row.maxRuns && project.planProjectNumber !== null) {
    const repo = { owner: project.repoOwner, name: project.repoName };
    const items = await deps.projects.listItems(repo.owner, project.planProjectNumber, repo);
    const found = candidates(items, await issueRuns(db, projectId), { order: row.order, skipLabel: row.skipLabel });
    Object.assign(result, found, { state: "idle" });
    const [first] = found.candidates;
    if (first) {
      const place = 1;
      const run = await startRun(
        db,
        {
          projectId,
          graphName: row.graphName,
          task: "",
          issues: [first.number],
          startedBy: "scheduler",
          items,
          events: [{ type: "run.scheduled", payload: { place, settings: settingsOf(row) } }],
        },
        { github: deps.github, projects: deps.projects },
      );
      result.started.push({ runId: run.id, issue: first.number });
      result.state = "running";
      await record(db, projectId, "scheduler.run_started", { runId: run.id, issue: first.number, place });
    }
  }
  await db
    .update(projectSchedulers)
    .set({ lastResult: result, lastCheckAt: sql`now()`, nextCheckAt: sql`now() + interval '${sql.raw(CHECK_EVERY)}'` })
    .where(eq(projectSchedulers.projectId, projectId));
  return result;
}

const settingsOf = (row: ProjectSchedulerRow) => ({ maxRuns: row.maxRuns, order: row.order, graphName: row.graphName, skipLabel: row.skipLabel });

async function record(db: DbExecutor, projectId: string, type: string, payload: Record<string, unknown>) {
  await db.insert(schedulerEvents).values({ projectId, type, payload });
}

/** Runs of the project in queued, running or waiting, whoever started them. */
async function activeRuns(db: DbExecutor, projectId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), inArray(runs.status, [...ACTIVE])));
  return row?.n ?? 0;
}

/** The run that counts for each issue of the project: its active run when it has one, else its latest run. */
async function issueRuns(db: DbExecutor, projectId: string): Promise<Map<number, IssueRun>> {
  const rows = await db.select({ id: runs.id, status: runs.status, issues: runs.issues }).from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.createdAt));
  const result = new Map<number, IssueRun>();
  for (const run of rows) {
    for (const { number } of run.issues) {
      const known = result.get(number);
      const isActive = (ACTIVE as readonly string[]).includes(run.status);
      if (!known || (isActive && !(ACTIVE as readonly string[]).includes(known.status))) result.set(number, { id: run.id, status: run.status });
    }
  }
  return result;
}
