import { eq, projects, type Db } from "@handoff/db";
import type { GitHubPort, PlanProject, ProjectsPort } from "@handoff/github";
import type { InboxView } from "../components/inbox/inbox-view";
import { isTodo, listBacklog, type BacklogIssue } from "./backlog";
import { layoutFlow } from "../lib/plan/flow";
import type { PlanMilestone } from "../lib/plan/milestones";
import type { PlanModeName } from "../lib/project-tab";
import { inboxGroups } from "./inbox-groups";
import { loadPlan, type PlanEpic, type PlanProgress, type PlanTask, type PlanUnavailable, type PlanView } from "./plan";
import { listRuns } from "./queries";
import { runLines, type RunLine } from "./run-lines";

/** A run on a project's Home page: its row in the runs list, what it is doing now, and whether it waits on a person. */
export type OverviewRun = Awaited<ReturnType<typeof listRuns>>[number] & { line: RunLine; needsYou: boolean };

/** A plan task with whether its latest run waits on a person, which shows as the Needs you chip. */
export type OverviewTask = PlanTask & { needsYou: boolean };

/** An epic with a task in Running or In review: its progress over all its tasks, and only those tasks. */
export type OverviewFeature = { number: number; title: string; url: string; progress: PlanProgress; tasks: OverviewTask[] };

/** A Ready task no run works on, with the title of the epic it belongs to when it has one. */
export type ReadyTask = PlanTask & { epic: string | undefined };

/**
 * An open milestone on Home: its due date, its tasks by status and the plan mode's judgement, and in Flow mode why
 * each of its skipped tasks is not in the order ("label human").
 */
export type OverviewMilestone = PlanMilestone & { skipped: { issue: number; why: string }[] };

/**
 * The work of a project with a plan: its open milestones, features in progress, Ready tasks and how many unplanned
 * issues can start too. `mode` is the plan mode, which decides what a milestone says: where it ends in the Flow's
 * order, or when it ends on the Timeline.
 */
export type PlanWork = {
  kind: "plan";
  project: PlanProject;
  mode: PlanModeName;
  milestones: OverviewMilestone[];
  features: OverviewFeature[];
  ready: ReadyTask[];
  unplannedToDo: number;
};

/**
 * The work of a project without a plan it can read, and why: its open issues with runs (one in flight,
 * failed or done), and those to do. The issues hold an error when GitHub cannot list them.
 */
export type IssueWork = {
  kind: "issues";
  reason: PlanUnavailable["reason"];
  error: string;
  issues: { withRuns: BacklogIssue[]; toDo: BacklogIssue[] } | { error: string };
};

async function issueWork(db: Db, github: GitHubPort | undefined, projectId: string, why: PlanUnavailable): Promise<IssueWork> {
  const backlog = await listBacklog(db, github, projectId);
  const issues = "error" in backlog ? { error: backlog.error } : { withRuns: backlog.issues.filter((i) => !isTodo(i)), toDo: backlog.issues.filter(isTodo) };
  return { kind: "issues", reason: why.reason, error: why.error, issues };
}

export type Overview = {
  /** This project's items of the inbox. */
  needsYou: InboxView;
  /** Active runs, newest first. */
  running: OverviewRun[];
  /** Runs that succeeded in the last day, the latest to finish first. Failed runs wait in Needs you instead. */
  finished: OverviewRun[];
  work: PlanWork | IssueWork;
};

const A_DAY = 24 * 3_600_000;

/** The runs of a project's inbox items that wait on a person: questions, reviews, permission requests and runs that stopped. */
export const waitingRuns = (view: InboxView) => new Set([...(view.permissions ?? []), ...view.reviews, ...view.questions, ...view.failedRuns, ...view.stuckRuns].map((i) => i.runId));

/** Every task of an epic: those under its stories and those hung on the epic itself. */
const tasksOf = (epic: PlanEpic) => [...epic.stories.flatMap((s) => s.tasks), ...epic.tasks];

const IN_FLIGHT = new Set(["Running", "In review"]);

function planWork(plan: PlanView, waiting: Set<string>): PlanWork {
  const mark = (task: PlanTask): OverviewTask => ({ ...task, needsYou: task.run !== null && waiting.has(task.run.id) });
  const features = plan.epics.flatMap((epic) => {
    const moving = tasksOf(epic).filter((t) => t.status !== undefined && IN_FLIGHT.has(t.status));
    return moving.length ? [{ number: epic.number, title: epic.title, url: epic.url, progress: epic.progress, tasks: moving.map(mark) }] : [];
  });
  const epicOf = new Map(plan.epics.flatMap((epic) => tasksOf(epic).map((t) => [t.number, epic.title] as const)));
  const toDo = plan.board.Ready.filter(isTodo).map((task): ReadyTask => ({ ...task, epic: epicOf.get(task.number) }));
  // Tasks that can start come first; blocked ones follow, as in the backlog.
  const ready = [...toDo.filter((t) => t.blockedBy.length === 0), ...toDo.filter((t) => t.blockedBy.length > 0)];
  return { kind: "plan", project: plan.project, mode: plan.flow ? "flow" : "timeline", milestones: openMilestones(plan), features, ready, unplannedToDo: plan.unplanned.filter(isTodo).length };
}

const SKIPPED = "Skipped: ";

/** The plan's open milestones in the port's order, each with why its skipped tasks are not in the Flow's order. */
function openMilestones(plan: PlanView): OverviewMilestone[] {
  const open = (plan.milestones ?? []).filter((m) => m.state === "open");
  const skips = plan.flow && open.some((m) => m.progress.flow?.skipped.length) ? layoutFlow(plan.flow).rows : [];
  const why = new Map(skips.flatMap((row) => row.tags.filter((t) => t.startsWith(SKIPPED)).map((t) => [row.issue, t.slice(SKIPPED.length)] as const)));
  return open.map((m) => ({ ...m, skipped: (m.progress.flow?.skipped ?? []).map((issue) => ({ issue, why: why.get(issue) ?? "skipped" })) }));
}

/** The project's plan, unless it has none linked; GitHub is only asked when it has. */
async function readPlan(db: Db, github: GitHubPort | undefined, plan: ProjectsPort | undefined, projectId: string): Promise<PlanView | PlanUnavailable> {
  const [project] = await db.select({ planProjectNumber: projects.planProjectNumber }).from(projects).where(eq(projects.id, projectId));
  if (project && project.planProjectNumber === null) return { reason: "no-plan", error: "This project has no plan on GitHub yet." };
  return loadPlan(db, github, plan, projectId);
}

/**
 * What a project's Home page shows: what waits on a person, the runs at work, the features in progress
 * and the work ready to start, and the runs that finished in the last day.
 */
export async function loadOverview(db: Db, github: GitHubPort | undefined, plan: ProjectsPort | undefined, projectId: string, opts: { now?: Date } = {}): Promise<Overview> {
  const now = opts.now ?? new Date();
  const [groups, active, succeeded, planned] = await Promise.all([
    inboxGroups(db, { projectId }),
    listRuns(db, { projectId, status: "active" }),
    listRuns(db, { projectId, status: "succeeded", finishedSince: new Date(now.getTime() - A_DAY) }),
    readPlan(db, github, plan, projectId),
  ]);
  const needsYou: InboxView = { ...groups, failedRuns: groups.failedRuns.map((f) => ({ ...f, error: f.error ?? null })) };
  const lines = await runLines(
    db,
    [...active, ...succeeded].map((r) => r.id),
  );
  const waiting = waitingRuns(needsYou);
  const withLine = (run: (typeof active)[number]): OverviewRun[] => {
    const line = lines.get(run.id);
    return line ? [{ ...run, line, needsYou: waiting.has(run.id) }] : [];
  };
  const finished = succeeded.toSorted((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
  const work = "reason" in planned ? await issueWork(db, github, projectId, planned) : planWork(planned, waiting);
  return { needsYou, running: active.flatMap(withLine), finished: finished.flatMap(withLine), work };
}
