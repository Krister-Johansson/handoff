import { eq, projects, runs, type Db } from "@handoff/db";
import { ProjectsAccessError, STATUS_OPTIONS, type AccessReason, type GitHubPort, type PlanItem, type PlanKind, type PlanProject, type PlanStatus, type ProjectsPort } from "@handoff/github";
import { latestRuns, type BacklogIssue, type BacklogRun } from "./backlog.ts";
import { deriveSpans, type Timeline, type TimelineRun } from "../lib/plan/schedule.ts";
import { durationOf, type Duration, type Forecasts } from "../lib/plan/forecast.ts";
import { latestProposals, loadForecasts, type Proposal } from "./forecasts.ts";
import { layoutFlow, type FlowInput } from "../lib/plan/flow.ts";
import { itemMilestones, milestoneProgress, type ItemMilestone, type MilestoneTasks, type PlanMilestone } from "../lib/plan/milestones.ts";
import { loadFlow } from "./flow.ts";

/** A board column: one per Status handoff knows, plus Other for an option it does not. */
export type PlanColumn = PlanStatus | "Other";
export type PlanProgress = {
  /** Tasks closed or in Done. */
  done: number;
  total: number;
  byStatus: Record<PlanColumn, number>;
  /** GitHub's own count of the direct sub-issues and the closed ones among them. */
  subIssues: { total: number; completed: number };
};
/**
 * A plan item with the milestone it is in: loadPlan gives an item without a milestone of its own the one it
 * inherits (a task its story's, else its epic's; a story its epic's), marked `inherited`.
 */
export type PlannedItem = PlanItem & { milestone?: ItemMilestone | undefined };
/**
 * A plan item with the latest run that links it; a closed item's status reads Done whatever its Status says.
 * loadPlan also sets the planner's latest proposed size and the task's duration; views built by hand may leave them out.
 */
export type PlanTask = PlannedItem & { run: BacklogRun | null; proposal?: Proposal | null; duration?: Duration | null };
export type PlanStory = PlannedItem & { tasks: PlanTask[]; progress: PlanProgress };
/** An epic with its stories, and the tasks whose parent is the epic itself. */
export type PlanEpic = PlannedItem & { stories: PlanStory[]; tasks: PlanTask[]; progress: PlanProgress };
export type PlanView = {
  /** The GitHub Project that holds the plan. */
  project: PlanProject;
  epics: PlanEpic[];
  /** Items no epic or story of the plan holds: `parent` is the issue outside the plan, or undefined. */
  unparented: PlanTask[];
  /** Every task by board column; Other holds tasks in a Status option handoff does not know. */
  board: Record<PlanColumn, PlanTask[]>;
  /** Open issues of the repository that are not items of the Project, newest activity first. */
  unplanned: BacklogIssue[];
  /**
   * Every item placed in time: planned and derived spans, each run's actual strip, late and overdue
   * items and the dependency arrows. Optional so views built by hand need not name it; loadPlan sets it
   * for a project in Timeline mode only.
   */
  timeline?: Timeline | undefined;
  /** What each size usually takes in this project; loadPlan sets it. */
  forecasts?: Forecasts | undefined;
  /** The person's hours of work a day on the plan; loadPlan sets it. */
  capacity?: number | undefined;
  /** What the Flow lays out with layoutFlow; loadPlan sets it for a project in Flow mode only. */
  flow?: FlowInput | undefined;
  /**
   * The repository's milestones, open and closed, those with a due date first by due date, each with its tasks
   * (own or inherited) and the plan mode's judgement: the Timeline's end against the due date, or the Flow's place
   * of its last task. Optional so views built by hand need not name it; loadPlan sets it.
   */
  milestones?: PlanMilestone[] | undefined;
  /** The tasks in no milestone, own or inherited; loadPlan sets it. */
  noMilestone?: MilestoneTasks | undefined;
};

/**
 * Why a project's plan cannot be shown, with a sentence that says what to do. `access` says which refusal
 * when GitHub refused the token for the owner's Project (a missing scope, SSO, classic tokens blocked).
 */
export type PlanUnavailable = { reason: "not-found" | "no-scope" | "no-plan" | "unreachable"; access?: AccessReason; error: string };

export const SCOPE_FIX ="Run gh auth refresh -s project, then set GITHUB_TOKEN=$(gh auth token).";
const NEEDS_TOKEN = `The plan needs GITHUB_TOKEN, a classic token with the project scope, which reaches user and organization Projects; handoff does not reach Projects through the GitHub App. ${SCOPE_FIX}`;

/**
 * What keeps handoff from GitHub Projects, as a sentence; undefined when the token can read and write them.
 * An organization's own refusal (SSO, classic tokens blocked) shows only when handoff reads its Project.
 */
export async function projectsAccessProblem(plan: ProjectsPort | undefined): Promise<string | undefined> {
  if (!plan) return NEEDS_TOKEN;
  const scopes = await plan.scopes();
  if (!scopes.classic) {
    return `GITHUB_TOKEN is a fine-grained token. A fine-grained token cannot reach a Project owned by a user, and handoff reads every Project, a user's or an organization's, with one classic token with the project scope. ${SCOPE_FIX}`;
  }
  if (!scopes.project) return `GITHUB_TOKEN lacks the project scope. ${SCOPE_FIX}`;
  return undefined;
}

const isStory = (kind: PlanKind | undefined) => kind === "story";
/** A task, or an issue nested too deep for depth to give it a kind. */
const isTask = (kind: PlanKind | undefined) => kind !== "story" && kind !== "epic";

/** The column a task belongs in: a closed task is done whatever its Status says. */
const columnOf = (task: PlanItem): PlanColumn => (task.state === "closed" ? "Done" : (task.status ?? "Other"));

const PLAN_COLUMNS: readonly PlanColumn[] = [...STATUS_OPTIONS, "Other"];
const columns = <T>(empty: () => T) => Object.fromEntries(PLAN_COLUMNS.map((c) => [c, empty()])) as Record<PlanColumn, T>;

function progressOf(item: PlanItem, tasks: PlanTask[]): PlanProgress {
  const byStatus = columns(() => 0);
  for (const task of tasks) byStatus[columnOf(task)]++;
  return { done: byStatus.Done, total: tasks.length, byStatus, subIssues: item.subIssues };
}

/**
 * A project's plan as its GitHub Project holds it: epics with their stories with their tasks, each task
 * with its latest run, and progress rolled up. GitHub is read on every call; nothing of the plan is stored.
 */
export async function loadPlan(
  db: Db,
  github: GitHubPort | undefined,
  plan: ProjectsPort | undefined,
  projectId: string,
  opts: { now?: Date } = {},
): Promise<PlanView | PlanUnavailable> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { reason: "not-found", error: "Project not found." };
  const problem = await projectsAccessProblem(plan);
  if (problem || !plan || !github) return { reason: "no-scope", error: problem ?? NEEDS_TOKEN };
  const number = project.planProjectNumber;
  if (number === null) return { reason: "no-plan", error: "This project has no plan on GitHub yet." };
  const repo = { owner: project.repoOwner, name: project.repoName };
  const flowMode = project.planMode === "flow";
  const read = await Promise.all([
    plan.getProject(repo.owner, number),
    plan.listItems(repo.owner, number, repo),
    github.listIssues(repo),
    github.listMilestones(repo),
    latestRuns(db, projectId),
    // A Flow project has no timeline, so its runs' strips are not read.
    flowMode ? [] : timelineRuns(db, projectId),
    latestProposals(db, projectId),
  ]).catch((error: unknown) => {
    // GitHub refused the token for this owner's Project: the sentence names the organization and what to do.
    if (error instanceof ProjectsAccessError) return error;
    throw error;
  });
  if (read instanceof ProjectsAccessError) return { reason: "no-scope", access: read.reason, error: read.message };
  const [planProject, items, open, repoMilestones, latest, projectRuns, proposals] = read;
  if (!planProject) return { reason: "unreachable", error: `GitHub Project #${number} of ${repo.owner} does not exist or GITHUB_TOKEN cannot see it.` };
  const byNumber = new Map(items.map((i) => [i.number, i]));
  const { forecasts, capacity } = await loadForecasts(db, projectId, (issue) => byNumber.get(issue)?.size);
  const sorted = [...items].sort((a, b) => a.number - b.number);
  // Only tasks take a duration; stories and epics keep the span their tasks give them.
  const durations = new Map(
    items.flatMap((item) => {
      const duration = isTask(item.kind) ? durationOf(item, forecasts, proposals.get(item.number)?.size) : undefined;
      return duration ? [[item.number, duration] as const] : [];
    }),
  );
  const milestoneOf = itemMilestones(items);
  const withMilestone = <T extends PlanItem>(item: T): T & { milestone?: ItemMilestone | undefined } => ({ ...item, milestone: milestoneOf.get(item.number) });
  const task = (item: PlanItem): PlanTask => ({
    ...withMilestone(item),
    status: item.state === "closed" ? "Done" : item.status,
    run: latest.get(item.number) ?? null,
    proposal: proposals.get(item.number) ?? null,
    duration: durations.get(item.number) ?? null,
  });

  // Each story hangs under its nearest epic, each task under its nearest story or epic; the walk stays inside the plan.
  const holderOf = (item: PlanItem): PlanItem | undefined => {
    const holds = (kind: PlanKind | undefined) => kind === "epic" || (kind === "story" && item.kind !== "story");
    const seen = new Set<number>();
    for (let p = item.parent; p !== undefined && !seen.has(p); p = byNumber.get(p)?.parent) {
      seen.add(p);
      const parent = byNumber.get(p);
      if (!parent) return undefined;
      if (holds(parent.kind)) return parent;
    }
    return undefined;
  };
  const children = new Map<number, PlanItem[]>();
  const unparented: PlanTask[] = [];
  for (const item of sorted) {
    if (item.kind === "epic") continue;
    const holder = holderOf(item);
    if (holder) children.set(holder.number, [...(children.get(holder.number) ?? []), item]);
    else unparented.push(task(item));
  }
  const childrenOf = (parent: number, kind: (k: PlanKind | undefined) => boolean) => (children.get(parent) ?? []).filter((i) => kind(i.kind));

  const epics = items
    .filter((i) => i.kind === "epic")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((epic) => {
      const stories = childrenOf(epic.number, isStory).map((story) => {
        const tasks = childrenOf(story.number, isTask).map(task);
        return { ...withMilestone(story), tasks, progress: progressOf(story, tasks) };
      });
      const tasks = childrenOf(epic.number, isTask).map(task);
      return { ...withMilestone(epic), stories, tasks, progress: progressOf(epic, [...stories.flatMap((s) => s.tasks), ...tasks]) };
    });
  const board = columns<PlanTask[]>(() => []);
  for (const item of sorted) if (isTask(item.kind)) board[columnOf(item)].push(task(item));
  const unplanned = open
    .filter((i) => !byNumber.has(i.number))
    .map((issue) => ({ ...issue, run: latest.get(issue.number) ?? null, plan: { kind: undefined, status: undefined, planned: false } }));
  // A Flow project gets the flow's input and no timeline: it shows no dates anywhere.
  const flow = flowMode ? await loadFlow(db, projectId, { items, priorityOptions: planProject.priorityOptions, forecasts }) : undefined;
  const timeline = flow ? undefined : deriveSpans(items, projectRuns, opts.now ?? new Date(), { durations, capacity });
  // Each milestone is judged by the mode: where its last task sits in the Flow's order, or its end on the Timeline.
  const progress = milestoneProgress(repoMilestones, items, flow ? { flow: layoutFlow(flow) } : { timeline });
  return {
    project: planProject,
    epics,
    unparented,
    board,
    unplanned,
    ...(flow ? { flow } : { timeline }),
    forecasts,
    capacity,
    milestones: progress.milestones,
    noMilestone: progress.none,
  };
}

/** Every run of a project with the issues it linked and when it ran, for the timeline's actual strips. */
async function timelineRuns(db: Db, projectId: string): Promise<TimelineRun[]> {
  const rows = await db
    .select({ id: runs.id, status: runs.status, issues: runs.issues, startedAt: runs.startedAt, finishedAt: runs.finishedAt })
    .from(runs)
    .where(eq(runs.projectId, projectId));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    issues: r.issues.map((i) => i.number),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));
}
