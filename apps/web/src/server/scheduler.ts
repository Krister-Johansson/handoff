import { runPath } from "@handoff/core/paths";
import {
  and,
  asc,
  desc,
  eq,
  graphs,
  inArray,
  liveWorkers,
  nodeExecutions,
  projects,
  projectSchedulers,
  runs,
  schedulerEvents,
  sql,
  type Db,
  type DbExecutor,
  type ProjectSchedulerRow,
} from "@handoff/db";
import { issueRuns, nudgeScheduler, overlapKey, projectHolds, type Candidate, type CheckResult, type Hold, type Skipped } from "@handoff/engine/backlog-scheduler";
import { ProjectsAccessError, type PlanProject, type ProjectsPort } from "@handoff/github";
import { getProjectDetail } from "./graphs";
import { projectsAccessProblem } from "./plan";
import { priorityField } from "../lib/scheduler-form";
import { holdText } from "../lib/scheduler-text";

export type SchedulerDeps = { db: Db; projects: ProjectsPort | undefined };

/** The settings start_scheduler may change; each left out keeps its stored value, or its default when first turned on. */
export type SchedulerSettings = {
  maxRuns?: number | undefined;
  order?: "project" | "priority" | undefined;
  graph?: string | undefined;
  /** Tasks with this label are left to a person; null skips none, and an empty label is null. */
  skipLabel?: string | null | undefined;
};

type Stored = Pick<ProjectSchedulerRow, "maxRuns" | "order" | "graphName" | "skipLabel">;

/** The settings as scheduler events and run.scheduled record them. */
const settingsOf = (row: Stored) => ({ maxRuns: row.maxRuns, order: row.order, graphName: row.graphName, skipLabel: row.skipLabel });
const same = (a: Stored, b: Stored) => JSON.stringify(settingsOf(a)) === JSON.stringify(settingsOf(b));

async function projectOf(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error(`There is no project ${projectId}.`);
  return project;
}

async function record(db: DbExecutor, projectId: string, type: string, payload: Record<string, unknown>) {
  await db.insert(schedulerEvents).values({ projectId, type, payload });
}

/**
 * Turns the project's scheduler on, or resumes it, with the settings given; the others keep their
 * stored values. Records scheduler.started the first time and after it was off, scheduler.resumed
 * after a pause and scheduler.changed when the settings change, and brings the next check forward.
 * Refuses a project without a plan and a graph the project does not have. With `resume: false` a
 * paused scheduler takes the settings and stays paused.
 */
export async function startScheduler(deps: SchedulerDeps, projectId: string, settings: SchedulerSettings, actor: string, opts: { resume?: boolean } = {}) {
  const { db } = deps;
  const project = await projectOf(db, projectId);
  if (project.isDemo) throw new Error(`${project.name} is a demo project: its runs are simulated, so the scheduler cannot start any.`);
  if (project.planProjectNumber === null) {
    throw new Error(`${project.name} has no plan: the scheduler starts runs on the plan's Ready tasks. Link a GitHub Project to it with setup_plan first.`);
  }
  const access = await projectsAccessProblem(deps.projects);
  if (access) throw new Error(`The scheduler reads Ready tasks from GitHub Projects. ${access}`);
  // The check reads the Project the way tick.ts does: the repository owner's Project by number. An organization
  // that refuses the token (SSO, classic tokens blocked) is named now, not at every check.
  const [plan, [stored]] = await Promise.all([
    deps.projects?.getProject(project.repoOwner, project.planProjectNumber).catch((error: unknown) => {
      if (error instanceof ProjectsAccessError) throw new Error(`The scheduler reads Ready tasks from GitHub Projects. ${error.message}`, { cause: error });
      throw error;
    }),
    db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)),
  ]);
  const graphName = settings.graph ?? stored?.graphName ?? (await getProjectDetail(db, projectId))?.defaultGraph;
  if (!graphName) throw new Error(`${project.name} has no graph yet. Create one on its Graphs page.`);
  const [graph] = await db.select({ id: graphs.id }).from(graphs).where(and(eq(graphs.projectId, projectId), eq(graphs.name, graphName)));
  if (!graph) throw new Error(`${project.name} has no graph ${graphName}.`);
  if (settings.order === "priority") {
    if (plan?.priorityOptions === undefined) throw new Error(noPriority(project.planProjectNumber, project.repoOwner, plan?.owner));
  }
  const skipLabel = settings.skipLabel === undefined ? (stored ? stored.skipLabel : "human") : settings.skipLabel?.trim() || null;
  const next: Stored = { maxRuns: settings.maxRuns ?? stored?.maxRuns ?? 1, order: settings.order ?? stored?.order ?? "project", graphName, skipLabel };

  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)).for("update");
    // Saving settings of a paused scheduler keeps the pause when asked to; only a resume resumes.
    const keepPause = opts.resume === false && before?.enabled === true && before.pausedAt !== null;
    const unpause = keepPause ? {} : { pausedAt: null, pausedBy: null, pauseReason: null, startFailures: 0 };
    const on = { enabled: true, maxRuns: next.maxRuns, order: next.order, graphName: next.graphName, skipLabel: next.skipLabel, ...unpause };
    await tx.insert(projectSchedulers).values({ projectId, ...on }).onConflictDoUpdate({ target: projectSchedulers.projectId, set: on });
    if (!before?.enabled) await record(tx, projectId, "scheduler.started", { by: actor, settings: settingsOf(next) });
    else {
      if (before.pausedAt && !keepPause) await record(tx, projectId, "scheduler.resumed", { by: actor });
      if (!same(before, next)) await record(tx, projectId, "scheduler.changed", { by: actor, from: settingsOf(before), to: settingsOf(next) });
    }
    // Turned on, resumed or changed: the next check comes now, or 10 seconds after the last.
    await nudgeScheduler(tx, projectId);
  });
  return { state: "on" as const, max_runs: next.maxRuns, order: next.order, graph: next.graphName };
}

/**
 * "Priority order from the organization's Priority issue field": the field a scheduler in Priority order reads, for
 * get_scheduler. Undefined without a plan, without Priority, or when GitHub cannot say.
 */
export async function priorityOrderText(projects: ProjectsPort | undefined, project: { repoOwner: string; planProjectNumber: number | null }) {
  if (!projects || project.planProjectNumber === null) return undefined;
  const plan = await projects.getProject(project.repoOwner, project.planProjectNumber).catch(() => undefined);
  return plan?.prioritySource ? `Priority order from ${priorityField(plan.prioritySource)}` : undefined;
}

/**
 * Why Priority order is refused: the Project has no Priority field and, in an organization, the organization has
 * no Priority issue field either.
 */
function noPriority(number: number, owner: string, ownerType: PlanProject["owner"]) {
  return ownerType === "Organization"
    ? `GitHub Project #${number} has no Priority field and ${owner} has no Priority issue field, so the scheduler cannot order tasks by priority. Add a single select field named Priority, or use Project order.`
    : `GitHub Project #${number} has no Priority field, so the scheduler cannot order tasks by priority. Add a single select field named Priority to the Project, or use Project order.`;
}

/**
 * Switches the project's scheduler to Project order, from the Flow's "Switch to Project order" after a drop
 * under Priority order (docs/plans/flow.md, Decision 3). Only the order changes: a scheduler that is off stays
 * off and a paused one stays paused. Records scheduler.changed; a scheduler without a row or already in Project
 * order changes nothing.
 */
export async function switchToProjectOrder(db: Db, projectId: string, actor: string) {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)).for("update");
    if (!before || before.order === "project") return;
    await tx.update(projectSchedulers).set({ order: "project" }).where(eq(projectSchedulers.projectId, projectId));
    await record(tx, projectId, "scheduler.changed", { by: actor, from: settingsOf(before), to: settingsOf({ ...before, order: "project" }) });
    if (before.enabled) await nudgeScheduler(tx, projectId);
  });
}

/**
 * Pauses the project's scheduler: no new starts until start_scheduler resumes it. Active runs go on.
 * Pausing a paused scheduler changes nothing, and a scheduler that is off stays off.
 */
export async function pauseScheduler(db: Db, projectId: string, actor: string, reason?: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)).for("update");
    if (!row?.enabled) return { state: "off" as const };
    if (row.pausedAt) return { state: "paused" as const, reason: row.pauseReason };
    await tx
      .update(projectSchedulers)
      .set({ pausedAt: sql`now()`, pausedBy: "person", pauseReason: reason ?? null })
      .where(eq(projectSchedulers.projectId, projectId));
    await record(tx, projectId, "scheduler.paused", { by: actor, ...(reason ? { reason } : {}) });
    return { state: "paused" as const, reason: reason ?? null };
  });
}

/**
 * Turns the project's scheduler off: it starts nothing and forgets its pause and its last check, and
 * keeps its settings for the next time someone turns it on, which starts it as the first time did.
 * Active runs go on. Turning off a scheduler that is off changes nothing.
 */
export async function stopScheduler(db: Db, projectId: string, actor: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)).for("update");
    if (!row?.enabled) return;
    await tx
      .update(projectSchedulers)
      .set({ enabled: false, pausedAt: null, pausedBy: null, pauseReason: null, startFailures: 0, lastResult: null })
      .where(eq(projectSchedulers.projectId, projectId));
    await record(tx, projectId, "scheduler.stopped", { by: actor });
  });
  return { state: "off" as const };
}

/**
 * Lets the scheduler take a task again after a person cancelled its run: records scheduler.released
 * for that run and brings the next check forward. A later cancel needs a new release. Refuses a task
 * whose latest run was not cancelled, since nothing then keeps the scheduler from it.
 */
export async function releaseTask(db: Db, projectId: string, issue: number, actor: string) {
  const run = (await issueRuns(db, projectId)).get(issue);
  if (!run) throw new Error(`#${issue} has no run, so the scheduler can take it already.`);
  if (run.status !== "cancelled") throw new Error(`#${issue} is not waiting for a person after a cancelled run: its latest run ${short(run.id)} is ${run.status}.`);
  await db.transaction(async (tx) => {
    await record(tx, projectId, "scheduler.released", { issue, runId: run.id, by: actor });
    await nudgeScheduler(tx, projectId);
  });
}

export type SchedulerState = "off" | "paused" | "held" | "idle" | "running";

/** A hold with the sentence and the page a person acts on. */
export type HoldView = Hold & { text: string; href: string };

/** A run the scheduler started that waits before its coder because its plan shares paths with another active run. */
export type OverlapHeld = { runId: string; nodeKey: string; waitsFor: string | null; paths: string[]; text: string; href: string };

/** Everything the scheduler card and get_scheduler show. */
export type SchedulerStatus = {
  state: SchedulerState;
  /** Undefined until someone turns the scheduler on. */
  settings: { maxRuns: number; order: "project" | "priority"; graphName: string; skipLabel: string | null } | undefined;
  paused: { by: string | null; reason: string | null; at: Date } | undefined;
  /** "2 of 3 runs active, 1 Claude slot". */
  summary: string;
  active: number;
  /** HANDOFF_CAP_CLI of the newest live worker; null without one. */
  claudeSlots: number | null;
  activeRuns: { id: string; status: string; startedBy: string | null; issues: number[]; href: string }[];
  holds: HoldView[];
  overlapHeld: OverlapHeld[];
  idle: { reason: string; text: string } | undefined;
  /** Why the last check failed, when it did. */
  error: string | undefined;
  /** The first three candidates of the last check, in order. */
  next: Candidate[];
  skipped: Skipped[];
  checkedAt: Date | null;
  nextCheckAt: Date | null;
  /** The last 20 scheduler events, oldest first. */
  events: { type: string; payload: Record<string, unknown>; at: Date }[];
};

const ACTIVE = ["queued", "running", "waiting"] as const;
const short = (id: string) => id.slice(0, 8);
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** A live worker heartbeats every 15 seconds; one silent for a minute is gone. */
const LIVE_WINDOW_MS = 60_000;

/** The project's scheduler as a person needs it: its state, what holds it, its runs, the Claude slots and what starts next. */
export async function getScheduler(db: Db, projectId: string): Promise<SchedulerStatus> {
  const runOverlap = sql<{ runId?: string; paths?: string[] } | null>`(
    select e.payload from events e
    where e.node_execution_id = ${nodeExecutions.id} and e.type = 'run.overlap_held'
    order by e.seq desc limit 1
  )`;
  const [[row], holds, activeRuns, held, live, eventRows] = await Promise.all([
    db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)),
    projectHolds(db, projectId),
    db
      .select({ id: runs.id, status: runs.status, startedBy: runs.startedBy, issues: runs.issues })
      .from(runs)
      .where(and(eq(runs.projectId, projectId), inArray(runs.status, [...ACTIVE])))
      .orderBy(asc(runs.createdAt)),
    db
      .select({ runId: nodeExecutions.runId, nodeKey: nodeExecutions.nodeKey, overlap: runOverlap })
      .from(nodeExecutions)
      .innerJoin(runs, eq(runs.id, nodeExecutions.runId))
      .where(and(eq(runs.projectId, projectId), eq(nodeExecutions.status, "waiting"), eq(nodeExecutions.waitKey, overlapKey(projectId))))
      .orderBy(asc(nodeExecutions.createdAt)),
    liveWorkers(db, LIVE_WINDOW_MS),
    db.select().from(schedulerEvents).where(eq(schedulerEvents.projectId, projectId)).orderBy(desc(schedulerEvents.id)).limit(20),
  ]);

  const worker = [...live].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  const claudeSlots = worker ? (worker.caps.cli ?? null) : null;
  const on = row?.enabled ? row : undefined;
  const runsText = row ? `${activeRuns.length} of ${plural(row.maxRuns, "run")} active` : `${plural(activeRuns.length, "run")} active`;
  const last = on?.lastResult as CheckResult | null | undefined;
  const state: SchedulerState = !on ? "off" : on.pausedAt ? "paused" : holds.length ? "held" : last?.state === "idle" ? "idle" : "running";

  return {
    state,
    settings: row ? { maxRuns: row.maxRuns, order: row.order, graphName: row.graphName, skipLabel: row.skipLabel } : undefined,
    paused: on?.pausedAt ? { by: on.pausedBy, reason: on.pauseReason, at: on.pausedAt } : undefined,
    summary: `${runsText}, ${claudeSlots === null ? "no worker running" : plural(claudeSlots, "Claude slot")}`,
    active: activeRuns.length,
    claudeSlots,
    activeRuns: activeRuns.map((r) => ({ id: r.id, status: r.status, startedBy: r.startedBy, issues: r.issues.map((i) => i.number), href: runPath(projectId, r.id) })),
    holds: holdViews(projectId, holds),
    overlapHeld: held.map((h) => {
      const paths = h.overlap?.paths ?? [];
      const waitsFor = h.overlap?.runId ?? null;
      return {
        runId: h.runId,
        nodeKey: h.nodeKey,
        waitsFor,
        paths,
        text: `Run ${short(h.runId)} waits before ${h.nodeKey}: shares ${paths.join(", ")} with run ${waitsFor ? short(waitsFor) : "another run"}`,
        href: runPath(projectId, h.runId),
      };
    }),
    idle: state === "idle" && last ? idleOf(last) : undefined,
    error: on && last?.state === "failed" ? last.error : undefined,
    next: on ? (last?.candidates ?? []).slice(0, 3) : [],
    skipped: on ? (last?.skipped ?? []) : [],
    checkedAt: row?.lastCheckAt ?? null,
    nextCheckAt: on && !on.pausedAt ? on.nextCheckAt : null,
    events: eventRows.reverse().map((e) => ({ type: e.type, payload: e.payload, at: e.createdAt })),
  };
}

function idleOf(last: CheckResult): { reason: string; text: string } {
  if (last.reason === "planning") return { reason: "planning", text: `Run ${short(last.runId ?? "")} is still planning; the next start waits for its plan.` };
  if (last.reason === "all_skipped") return { reason: "all_skipped", text: "Every Ready task is skipped; skipped says why." };
  return { reason: "no_ready", text: "No task is Ready. Move shaped tasks to Ready on the Plan." };
}

/** Each hold with its sentence and the run page that clears it. */
function holdViews(projectId: string, holds: Hold[]): HoldView[] {
  return holds.map((hold): HoldView => ({ ...hold, text: holdText(hold), href: runPath(projectId, hold.runId) }));
}
