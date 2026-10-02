import { toneOf } from "@handoff/core";
import { and, createNotification, desc, eq, inArray, isNull, projects, projectSchedulers, runs, schedulerEvents, sql, type Db, type DbExecutor, type ProjectSchedulerRow } from "@handoff/db";
import type { GitHubPort, ProjectsPort } from "@handoff/github";
import { StartRefusal, startRun } from "../start-run.ts";
import { candidates, type Candidate, type IssueRun, type Skipped } from "./candidates.ts";
import { projectHolds, type Hold } from "./holds.ts";

type ProjectRow = typeof projects.$inferSelect;

export type CheckDeps = {
  db: Db;
  github: GitHubPort;
  projects: ProjectsPort;
  /** Who checks: the worker's id, kept as the lease owner while the check runs. */
  owner: string;
  /** How long a check may hold the project before another worker may check it; 2 minutes unless given. */
  leaseMs?: number | undefined;
};

/** Why a check that could start something started nothing. */
export type IdleReason =
  /** A run the scheduler started has no plan yet: its planner finishes before the next start. */
  | { reason: "planning"; runId: string }
  /** No open task in Ready. */
  | { reason: "no_ready" }
  /** Every Ready task was skipped, each with its reason. */
  | { reason: "all_skipped" };

/** What a check found, kept on the scheduler's row for the status reads. */
export type CheckResult = {
  state: "held" | "full" | "idle" | "running" | "failed";
  holds: Hold[];
  active: number;
  maxRuns: number;
  started: { runId: string; issue: number }[];
  candidates: Candidate[];
  skipped: Skipped[];
  reason?: IdleReason["reason"];
  runId?: string;
  /** Why the check failed, when its state is failed. */
  error?: string;
};

const ACTIVE = ["queued", "running", "waiting"] as const;
const isActive = (status: string) => (ACTIVE as readonly string[]).includes(status);
const CHECK_EVERY = "60 seconds";
const PAUSE_AFTER = 3;
const LEASE_MS = 120_000;

/**
 * One check of a project's scheduler: stops on a hold, a full project or a run of its own still
 * planning; otherwise reads the plan once and starts the first candidate with the scheduler's
 * graph. It keeps what it found on the row and records what changed as scheduler events.
 */
export async function checkProject(deps: CheckDeps, projectId: string): Promise<CheckResult | undefined> {
  const { db } = deps;
  const row = await claim(db, projectId, deps.owner, deps.leaseMs ?? LEASE_MS);
  if (!row) return undefined;
  try {
    return await check(deps, row);
  } finally {
    await db
      .update(projectSchedulers)
      .set({ leaseOwner: null, leaseExpiresAt: null })
      .where(and(eq(projectSchedulers.projectId, projectId), eq(projectSchedulers.leaseOwner, deps.owner)));
  }
}

/**
 * Takes the project's lease when its scheduler is on, not paused and no other check holds it, so
 * two checks of one project never run at once. Undefined when the lease is taken or nothing is to check.
 */
async function claim(db: DbExecutor, projectId: string, owner: string, leaseMs: number): Promise<ProjectSchedulerRow | undefined> {
  const [row] = await db
    .update(projectSchedulers)
    .set({ leaseOwner: owner, leaseExpiresAt: sql`now() + make_interval(secs => ${leaseMs / 1000})` })
    .where(
      and(
        eq(projectSchedulers.projectId, projectId),
        eq(projectSchedulers.enabled, true),
        isNull(projectSchedulers.pausedAt),
        sql`(${projectSchedulers.leaseExpiresAt} is null or ${projectSchedulers.leaseExpiresAt} < now())`,
      ),
    )
    .returning();
  return row;
}

async function check(deps: CheckDeps, row: ProjectSchedulerRow): Promise<CheckResult | undefined> {
  const { db } = deps;
  const projectId = row.projectId;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return undefined;
  const previous = row.lastResult as CheckResult | null;
  let result: CheckResult;
  try {
    result = await examine(deps, row, project);
  } catch (error) {
    // Not a refusal of one task: the graph is gone, GitHub refuses, or the like. Three in a row pause.
    result = { state: "failed", error: error instanceof Error ? error.message : String(error), holds: [], active: 0, maxRuns: row.maxRuns, started: [], candidates: [], skipped: [] };
  }
  await recordChanges(db, projectId, previous, result);
  const failures = result.state === "failed" ? row.startFailures + 1 : 0;
  const pause = failures >= PAUSE_AFTER ? `${failures} starts failed in a row. The last error: ${result.error}` : undefined;
  await db
    .update(projectSchedulers)
    .set({
      lastResult: result,
      lastCheckAt: sql`now()`,
      nextCheckAt: sql`now() + interval '${sql.raw(CHECK_EVERY)}'`,
      startFailures: failures,
      ...(pause ? { pausedAt: sql`now()`, pausedBy: "scheduler", pauseReason: pause } : {}),
    })
    .where(eq(projectSchedulers.projectId, projectId));
  if (pause) {
    await record(db, projectId, "scheduler.paused", { by: "scheduler", reason: pause });
    await createNotification(db, { tone: toneOf("failed"), projectId, title: `${project.name}: the scheduler paused itself`, body: pause, href: `/projects/${projectId}/plan` });
  }
  return result;
}

async function examine(deps: CheckDeps, row: ProjectSchedulerRow, project: ProjectRow): Promise<CheckResult> {
  const { db } = deps;
  const projectId = row.projectId;
  const holds = await projectHolds(db, projectId);
  const active = await activeRuns(db, projectId);
  const result: CheckResult = { state: "held", holds, active, maxRuns: row.maxRuns, started: [], candidates: [], skipped: [] };
  // A hold waits on a person, a full project has no slot, and a run still planning has no paths yet: none reads GitHub.
  if (holds.length) return result;
  if (active >= row.maxRuns) return { ...result, state: "full" };
  if (project.planProjectNumber === null) throw new Error("The project has no plan: link a GitHub Project to it with setup_plan.");
  const planning = await planningRun(db, projectId);
  if (planning) return { ...result, state: "idle", reason: "planning", runId: planning };
  const repo = { owner: project.repoOwner, name: project.repoName };
  const items = await deps.projects.listItems(repo.owner, project.planProjectNumber, repo);
  const found = candidates(items, await issueRuns(db, projectId), { order: row.order, skipLabel: row.skipLabel });
  const skipped = [...found.skipped];
  await recordSkips(db, projectId, found.skipped);
  // One start per check: the run it starts has no plan yet, so the next check waits for its planner.
  for (const [index, candidate] of found.candidates.entries()) {
    const place = index + 1;
    try {
      const run = await startRun(
        db,
        {
          projectId,
          graphName: row.graphName,
          task: "",
          issues: [candidate.number],
          startedBy: "scheduler",
          items,
          maxActive: row.maxRuns,
          events: [{ type: "run.scheduled", payload: { place, settings: settingsOf(row) } }],
        },
        { github: deps.github, projects: deps.projects },
      );
      await record(db, projectId, "scheduler.run_started", { runId: run.id, issue: candidate.number, place });
      return { ...result, candidates: found.candidates.slice(place), skipped, state: "running", started: [{ runId: run.id, issue: candidate.number }] };
    } catch (error) {
      if (!(error instanceof StartRefusal)) throw error;
      // A run started since the count took the last slot.
      if (error.reason === "full") return { ...result, active: row.maxRuns, candidates: found.candidates.slice(index), skipped, state: "full" };
      // A refusal is about this task only: it is skipped for this check and the next candidate is tried.
      const skip = { number: candidate.number, title: candidate.title, reason: error.message };
      skipped.push(skip);
      await recordSkips(db, projectId, [skip]);
    }
  }
  return { ...result, skipped, state: "idle", reason: skipped.length ? "all_skipped" : "no_ready" };
}

/** Held and idle are recorded when they begin or their reasons change, not on every check. */
async function recordChanges(db: DbExecutor, projectId: string, previous: CheckResult | null, result: CheckResult) {
  if (result.state === "held" && (previous?.state !== "held" || !same(previous.holds, result.holds))) {
    await record(db, projectId, "scheduler.held", { holds: result.holds });
  }
  if (result.state === "failed") await record(db, projectId, "scheduler.start_failed", { error: result.error });
  if (result.state === "idle") {
    const idle = idleOf(result);
    if (previous?.state !== "idle" || !same(idleOf(previous), idle)) await record(db, projectId, "scheduler.idle", idle);
  }
}

/** Records each skip unless the issue's last recorded skip had the same reason. */
async function recordSkips(db: DbExecutor, projectId: string, skips: Skipped[]) {
  if (skips.length === 0) return;
  const { rows } = await db.execute<{ issue: number; reason: string }>(sql`
    select distinct on (payload->>'issue') (payload->>'issue')::int as issue, payload->>'reason' as reason
    from scheduler_events
    where project_id = ${projectId} and type = 'scheduler.skipped'
    order by payload->>'issue', id desc`);
  const last = new Map(rows.map((r) => [r.issue, r.reason]));
  for (const skip of skips) {
    if (last.get(skip.number) !== skip.reason) await record(db, projectId, "scheduler.skipped", { issue: skip.number, reason: skip.reason });
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const idleOf = (result: CheckResult) => (result.reason === "planning" ? { reason: result.reason, runId: result.runId } : { reason: result.reason });

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

/** The newest active run the scheduler started that has no plan yet. */
async function planningRun(db: DbExecutor, projectId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.startedBy, "scheduler"), inArray(runs.status, [...ACTIVE]), sql`${runs.state}->'plan' is null`))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  return row?.id;
}

/** The run that counts for each issue of the project: its active run when it has one, else its latest run. */
async function issueRuns(db: DbExecutor, projectId: string): Promise<Map<number, IssueRun>> {
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
