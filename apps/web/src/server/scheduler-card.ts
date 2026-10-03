import { and, desc, eq, inArray, projectSchedulers, runs, schedulerEvents, type Db } from "@handoff/db";
import { candidates, issueRuns, releasedRuns, type Candidate, type Skipped } from "@handoff/engine/backlog-scheduler";
import type { PlanItem } from "@handoff/github";
import type { Flow } from "../lib/plan/flow";
import { runPath } from "../lib/paths";
import { describeSchedulerEvent } from "../lib/scheduler-text";
import type { StatusTone } from "../lib/status";
import { runLines } from "./run-lines";
import { getScheduler, type SchedulerState, type SchedulerStatus } from "./scheduler";

/** An active run as the scheduler card lists it: its task, the step it is at and what it waits for. */
export type ActiveRunView = {
  id: string;
  href: string;
  startedBy: string | null;
  /** The run's first issue; null for a run started from a task text alone. */
  issue: { number: number; title: string } | null;
  /** The step running, waiting or queued now. */
  node: string | null;
  now: { tone: StatusTone; text: string };
  /** The review page, while the run waits for a review. */
  reviewHref?: string;
};

/** A scheduler event as a sentence. */
export type SchedulerEventView = { id: number; type: string; text: string; at: Date };

type IssueRef = { number: number; title: string };

/** Everything the scheduler card, its sheet and Project settings show. */
export type SchedulerCard = {
  status: SchedulerStatus;
  runs: ActiveRunView[];
  /** The task of each hold's run, by run id. */
  holdIssues: Record<string, IssueRef>;
  /** The last 50 events, newest first. */
  events: SchedulerEventView[];
  /** Where a person paused the scheduler from (dashboard, claude-code, ...); null unless a person paused it. */
  pausedFrom: string | null;
  /** The first three tasks it starts next, from the last check, or from the plan while the check has none. */
  next: Candidate[];
  skipped: SkippedView[];
};

/** A skipped Ready task; `releasable` when a person cancelled its run and can let the scheduler take it again. */
export type SkippedView = Skipped & { releasable?: true };

/** The plan as the page read it, for Next up while the last check has none. */
export type PlanRead = { items: PlanItem[]; priorityOptions: string[] | undefined };

/** How many events the All events sheet shows. */
const EVENTS = 50;

const IN_PROGRESS = new Set(["running", "waiting", "pending"]);

/** Each active run with its task, its current step and its line, oldest first. */
async function activeRunViews(db: Db, projectId: string, status: SchedulerStatus): Promise<ActiveRunView[]> {
  const ids = status.activeRuns.map((r) => r.id);
  if (ids.length === 0) return [];
  const [lines, issues] = await Promise.all([runLines(db, ids), runIssues(db, ids)]);
  return status.activeRuns.map((run): ActiveRunView => {
    const line = lines.get(run.id);
    const issue = issues[run.id];
    return {
      id: run.id,
      href: runPath(projectId, run.id),
      startedBy: run.startedBy,
      issue: issue ?? null,
      node: line?.steps.findLast((s) => IN_PROGRESS.has(s.status))?.nodeKey ?? null,
      now: line?.now ?? { tone: "neutral", text: run.status },
      ...(line?.reviewHref ? { reviewHref: line.reviewHref } : {}),
    };
  });
}

/** The first issue of each run, by run id. */
async function runIssues(db: Db, ids: string[]): Promise<Record<string, IssueRef>> {
  if (ids.length === 0) return {};
  const rows = await db.select({ id: runs.id, issues: runs.issues }).from(runs).where(inArray(runs.id, ids));
  return Object.fromEntries(rows.flatMap((r) => (r.issues[0] ? [[r.id, { number: r.issues[0].number, title: r.issues[0].title }]] : [])));
}

/** Where the latest pause came from, as its scheduler.paused event records it. */
async function pausedFrom(db: Db, projectId: string, status: SchedulerStatus): Promise<string | null> {
  if (status.paused?.by !== "person") return null;
  const [event] = await db
    .select({ payload: schedulerEvents.payload })
    .from(schedulerEvents)
    .where(and(eq(schedulerEvents.projectId, projectId), eq(schedulerEvents.type, "scheduler.paused")))
    .orderBy(desc(schedulerEvents.id))
    .limit(1);
  return typeof event?.payload.by === "string" ? event.payload.by : null;
}

/**
 * What the scheduler starts next and what it skips. A check that is held, full or waits on a run
 * still planning reads no plan and keeps no candidates, and neither does a scheduler not checked yet;
 * then the plan the page already read gives them, through the scheduler's own choice.
 */
async function nextUp(db: Db, projectId: string, status: SchedulerStatus, plan: PlanRead | undefined): Promise<{ next: Candidate[]; skipped: SkippedView[] }> {
  if (status.state === "off" || !status.settings) return { next: [], skipped: [] };
  const [byIssue, released] = await Promise.all([issueRuns(db, projectId), releasedRuns(db, projectId)]);
  const fromPlan =
    status.next.length === 0 && plan
      ? candidates(plan.items, byIssue, { order: status.settings.order, priorityOptions: plan.priorityOptions, skipLabel: status.settings.skipLabel, released })
      : undefined;
  const skipped = fromPlan?.skipped ?? status.skipped;
  const releasable = (s: Skipped) => {
    const run = byIssue.get(s.number);
    return run?.status === "cancelled" && !released.has(run.id);
  };
  return {
    next: fromPlan ? fromPlan.candidates.slice(0, 3) : status.next,
    skipped: skipped.map((s) => (releasable(s) ? { ...s, releasable: true as const } : s)),
  };
}

/**
 * The project's scheduler for the dashboard: its status with the runs and holds named, its events as
 * sentences, who paused it, and what it starts next, from `plan` while the last check has no candidates.
 */
export async function loadSchedulerCard(db: Db, projectId: string, plan?: PlanRead): Promise<SchedulerCard> {
  const status = await getScheduler(db, projectId);
  const [active, holdIssues, eventRows, from, next] = await Promise.all([
    activeRunViews(db, projectId, status),
    runIssues(db, [...new Set(status.holds.map((h) => h.runId))]),
    db.select().from(schedulerEvents).where(eq(schedulerEvents.projectId, projectId)).orderBy(desc(schedulerEvents.id)).limit(EVENTS),
    pausedFrom(db, projectId, status),
    nextUp(db, projectId, status, plan),
  ]);
  const events = eventRows.map((e) => ({ id: e.id, type: e.type, text: describeSchedulerEvent(e), at: e.createdAt }));
  return { status, runs: active, holdIssues, events, pausedFrom: from, ...next };
}

/** A project's scheduler as Settings, Projects shows it on the project's row. */
export type SchedulerBrief = { state: SchedulerState; active: number; maxRuns: number };

/** The scheduler of each project that has it on, by project id; a project with it off is left out. */
export async function schedulerStates(db: Db): Promise<Record<string, SchedulerBrief>> {
  const on = await db.select({ projectId: projectSchedulers.projectId }).from(projectSchedulers).where(eq(projectSchedulers.enabled, true));
  const states = await Promise.all(
    on.map(async ({ projectId }) => {
      const status = await getScheduler(db, projectId);
      return [projectId, { state: status.state, active: status.active, maxRuns: status.settings?.maxRuns ?? 1 }] as const;
    }),
  );
  return Object.fromEntries(states);
}

/**
 * The place of each next task in the scheduler's order, by issue number, for the Plan's Next tags. In a Flow
 * project they come from the flow (docs/plans/flow.md, Decision 3): every Ready task in its place, blocked ones
 * counted, so the tree, the Flow and a drag agree.
 */
export function nextPlaces(card: Pick<SchedulerCard, "next">, flow?: Flow): Record<number, number> {
  const order = flow ? flow.ready : card.next.map((task) => task.number);
  return Object.fromEntries(order.map((issue, i) => [issue, i + 1]));
}
