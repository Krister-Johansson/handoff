import { eq, projects, runs, type Db } from "@handoff/db";
import { STATUS_OPTIONS, type GitHubPort, type PlanItem, type PlanKind, type PlanProject, type PlanStatus, type ProjectsPort } from "@handoff/github";
import { latestRuns, type BacklogIssue, type BacklogRun } from "./backlog.ts";
import { deriveSpans, type Timeline, type TimelineRun } from "../lib/plan/schedule.ts";
import { durationOf, type Duration, type Forecasts } from "../lib/plan/forecast.ts";
import { latestProposals, loadForecasts, type Proposal } from "./forecasts.ts";
import type { FlowInput } from "../lib/plan/flow.ts";
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
 * A plan item with the latest run that links it; a closed item's status reads Done whatever its Status says.
 * loadPlan also sets the planner's latest proposed size and the task's duration; views built by hand may leave them out.
 */
export type PlanTask = PlanItem & { run: BacklogRun | null; proposal?: Proposal | null; duration?: Duration | null };
export type PlanStory = PlanItem & { tasks: PlanTask[]; progress: PlanProgress };
/** An epic with its stories, and the tasks whose parent is the epic itself. */
export type PlanEpic = PlanItem & { stories: PlanStory[]; tasks: PlanTask[]; progress: PlanProgress };
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
   * items and the dependency arrows. Optional so views built by hand need not name it; loadPlan sets it.
   */
  timeline?: Timeline | undefined;
  /** What each size usually takes in this project; loadPlan sets it. */
  forecasts?: Forecasts | undefined;
  /** The person's hours of work a day on the plan; loadPlan sets it. */
  capacity?: number | undefined;
  /** What the Flow lays out with layoutFlow; loadPlan sets it for a project in Flow mode only. */
  flow?: FlowInput | undefined;
};

/** Why a project's plan cannot be shown, with a sentence that says what to do. */
export type PlanUnavailable = { reason: "not-found" | "no-scope" | "no-plan" | "unreachable"; error: string };

export const SCOPE_FIX ="Run gh auth refresh -s project, then set GITHUB_TOKEN=$(gh auth token).";
const NEEDS_TOKEN = `The plan needs GITHUB_TOKEN, a classic token with the project scope; a GitHub App cannot reach a user-owned Project. ${SCOPE_FIX}`;

/** What keeps handoff from GitHub Projects, as a sentence; undefined when the token can read and write them. */
export async function projectsAccessProblem(plan: ProjectsPort | undefined): Promise<string | undefined> {
  if (!plan) return NEEDS_TOKEN;
  const scopes = await plan.scopes();
  if (!scopes.classic) return `GITHUB_TOKEN is not a classic token, and only a classic token with the project scope can reach a user-owned Project. ${SCOPE_FIX}`;
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
  const [planProject, items, open, latest, projectRuns, proposals] = await Promise.all([
    plan.getProject(repo.owner, number),
    plan.listItems(repo.owner, number, repo),
    github.listIssues(repo),
    latestRuns(db, projectId),
    timelineRuns(db, projectId),
    latestProposals(db, projectId),
  ]);
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
  const task = (item: PlanItem): PlanTask => ({
    ...item,
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
        return { ...story, tasks, progress: progressOf(story, tasks) };
      });
      const tasks = childrenOf(epic.number, isTask).map(task);
      return { ...epic, stories, tasks, progress: progressOf(epic, [...stories.flatMap((s) => s.tasks), ...tasks]) };
    });
  const board = columns<PlanTask[]>(() => []);
  for (const item of sorted) if (isTask(item.kind)) board[columnOf(item)].push(task(item));
  const unplanned = open
    .filter((i) => !byNumber.has(i.number))
    .map((issue) => ({ ...issue, run: latest.get(issue.number) ?? null, plan: { kind: undefined, status: undefined, planned: false } }));
  const flow = project.planMode === "flow" ? await loadFlow(db, projectId, { items, priorityOptions: planProject.priorityOptions, forecasts }) : undefined;
  return {
    project: planProject,
    epics,
    unparented,
    board,
    unplanned,
    timeline: deriveSpans(items, projectRuns, opts.now ?? new Date(), { durations, capacity }),
    forecasts,
    capacity,
    ...(flow ? { flow } : {}),
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
