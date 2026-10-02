import { and, desc, eq, inArray, runs, schedulerEvents, type Db } from "@handoff/db";
import { runPath } from "../lib/paths";
import { describeSchedulerEvent } from "../lib/scheduler-text";
import type { StatusTone } from "../lib/status";
import { runLines } from "./run-lines";
import { getScheduler, type SchedulerStatus } from "./scheduler";

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
};

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

/** The project's scheduler for the dashboard: its status with the runs and holds named, its events as sentences and who paused it. */
export async function loadSchedulerCard(db: Db, projectId: string): Promise<SchedulerCard> {
  const status = await getScheduler(db, projectId);
  const [active, holdIssues, eventRows, from] = await Promise.all([
    activeRunViews(db, projectId, status),
    runIssues(db, [...new Set(status.holds.map((h) => h.runId))]),
    db.select().from(schedulerEvents).where(eq(schedulerEvents.projectId, projectId)).orderBy(desc(schedulerEvents.id)).limit(EVENTS),
    pausedFrom(db, projectId, status),
  ]);
  const events = eventRows.map((e) => ({ id: e.id, type: e.type, text: describeSchedulerEvent(e), at: e.createdAt }));
  return { status, runs: active, holdIssues, events, pausedFrom: from };
}
