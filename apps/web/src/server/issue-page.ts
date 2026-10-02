import { and, asc, desc, eq, graphs, graphVersions, inArray, isNull, projects, questions, runs, sql, type Db } from "@handoff/db";
import { GitHubReadError, type GitHubPort, type IssueComment, type IssueDetail, type IssueRef, type PlanProject, type PlanStatus, type ProjectsPort } from "@handoff/github";
import { reviewPath, runPath, tryPath } from "../lib/paths";
import { inboxGroups } from "./inbox-groups";
import { waitingRuns } from "./overview";
import { loadPlan, type PlanEpic, type PlanProgress, type PlanStory, type PlanTask, type PlanUnavailable, type PlanView } from "./plan";
import { runLines, type RunLine } from "./run-lines";
import type { Timeline } from "../lib/plan/schedule";

/** What a run waits on from a person: a review or a question, with the page that answers it. */
export type RunWait = { kind: "review" | "question"; text: string; href: string };

/** A run on an issue as the issue page shows it: the Overview's run row with its start, branch and what it waits on. */
export type IssueRun = {
  id: string;
  status: string;
  task: string;
  graph: string;
  version: number;
  branch: string;
  startedBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  prNumber: number | null;
  /** The issue's title as the run linked it, which stands in for GitHub's when GitHub does not answer. */
  issueTitle: string;
  line: RunLine;
  /** It waits on a person: a question, a review, a permission request, or it failed or got stuck. */
  needsYou: boolean;
  /** The oldest open review or question, which the row offers to open. */
  waitingOn: RunWait | null;
};

/** Where the page sits in the sidebar: Plan for an item of the plan, Issues for any other issue. */
export type IssueSection = "plan" | "issues";
export type IssueKind = "task" | "story" | "epic" | "issue";

/** An issue blocking this one or blocked by it, with its Status when it is an item of the plan. */
export type IssueLink = IssueRef & { status: PlanStatus | undefined };

/** Where an issue outside the plan stands: why, when the project's plan cannot be read or there is none. */
export type Unplanned = { planned: false; reason: PlanUnavailable["reason"] | undefined; error: string | undefined; project: PlanProject | undefined };

/** A story or an epic a plan item is part of, with its progress over all its tasks. */
export type PlanParent = { kind: "story" | "epic"; number: number; title: string; url: string; progress: PlanProgress };

/** A task of the plan: its item, and the story and the epic it is part of, nearest first. */
export type PlannedTask = { planned: true; kind: "task"; project: PlanProject; item: PlanTask; parents: PlanParent[] };

/** A task under a story or an epic on the page, with whether its latest run waits on a person (the Needs you chip). */
export type IssueTask = PlanTask & { needsYou: boolean };

/** A story of the plan: its tasks in GitHub's sub-issue order, its epic, and the timeline of it and its tasks. */
export type PlannedStory = {
  planned: true;
  kind: "story";
  project: PlanProject;
  item: Omit<PlanStory, "tasks"> & { tasks: IssueTask[] };
  parents: PlanParent[];
  timeline: Timeline | undefined;
};

/** What an epic waits on: tasks whose runs need a person, and the open blockers that hold its tasks, the one that holds the most first. */
export type EpicWaiting = {
  needsYou: number[];
  /** How many of its open tasks wait on an open blocker. */
  waitingTasks: number;
  blockers: { number: number; title: string; url: string; status: PlanStatus | undefined; blocks: number }[];
};

/** An epic of the plan: its stories in GitHub's sub-issue order, what waits, and the timeline of it and its stories. */
export type PlannedEpic = {
  planned: true;
  kind: "epic";
  project: PlanProject;
  item: Omit<PlanEpic, "stories" | "tasks"> & { stories: (Omit<PlanStory, "tasks"> & { tasks: IssueTask[] })[]; tasks: IssueTask[] };
  waiting: EpicWaiting;
  timeline: Timeline | undefined;
};

type Planned = PlannedTask | PlannedStory | PlannedEpic;
export type IssuePlace = Unplanned | Planned;

export type FoundIssue = {
  state: "found";
  section: IssueSection;
  kind: IssueKind;
  issue: IssueDetail;
  place: IssuePlace;
  /** Open ones first, then the closed ones, each group in GitHub's order. */
  blockedBy: IssueLink[];
  blocking: IssueLink[];
  comments: IssueComment[];
  /** The token's user, "you" on the dashboard; undefined with a GitHub App. */
  viewer: string | undefined;
};

/**
 * One issue as its page shows it, read from GitHub on every call, or why it cannot be shown: GitHub
 * does not know the number, the number is a pull request's, or GitHub did not answer (then the title
 * the latest run linked stands in, when a run linked it).
 */
export type IssuePage = FoundIssue | { state: "not-found" } | { state: "pull-request"; url: string } | { state: "unreachable"; error: string; title: string | null };

const NO_GITHUB = "Set GITHUB_TOKEN or a GitHub App for the dashboard to read the repository's issues.";

const openFirst = <T extends { state: "open" | "closed" }>(items: T[]) => [...items.filter((i) => i.state === "open"), ...items.filter((i) => i.state === "closed")];

export async function loadIssuePage(
  db: Db,
  github: GitHubPort | undefined,
  plan: ProjectsPort | undefined,
  projectId: string,
  number: number,
  opts: { runs?: IssueRun[] } = {},
): Promise<IssuePage> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { state: "not-found" };
  const repo = { owner: project.repoOwner, name: project.repoName };
  const unreachable = async (error: string): Promise<IssuePage> => {
    const runsOf = opts.runs ?? (await issueRuns(db, projectId, number));
    return { state: "unreachable", error, title: runsOf.find((r) => r.issueTitle)?.issueTitle ?? null };
  };
  if (!github) return unreachable(NO_GITHUB);
  let issue: IssueDetail;
  try {
    issue = await github.getIssue(repo, number);
  } catch (error) {
    if (error instanceof GitHubReadError && error.reason === "not-found") return { state: "not-found" };
    return unreachable(error instanceof Error ? error.message : String(error));
  }
  if (issue.pullRequest) return { state: "pull-request", url: issue.url };
  const [dependencies, comments, viewer, planned, order, waiting] = await Promise.all([
    github.dependencies(repo, number),
    github.listIssueComments(repo, number),
    github.viewer().catch(() => undefined),
    loadPlan(db, github, plan, projectId),
    // The sub-issue order of a story or an epic; a task's list is empty and costs one call.
    github.listSubIssues(repo, number).then((refs) => refs.map((r) => r.number)),
    inboxGroups(db, { projectId }).then((groups) => waitingRuns({ ...groups, failedRuns: groups.failedRuns.map((f) => ({ ...f, error: f.error ?? null })) })),
  ]);
  const place: IssuePlace =
    "reason" in planned
      ? { planned: false, reason: planned.reason, error: planned.error, project: undefined }
      : (placeIn(planned, number, { waiting, order }) ?? { planned: false, reason: undefined, error: undefined, project: planned.project });
  const statusOf = new Map("reason" in planned ? [] : planItems(planned).map((i) => [i.number, i.status] as const));
  const link = (ref: IssueRef): IssueLink => ({ ...ref, status: statusOf.get(ref.number) });
  return {
    state: "found",
    section: place.planned ? "plan" : "issues",
    kind: place.planned ? place.kind : "issue",
    issue,
    place,
    blockedBy: openFirst(dependencies.blockedBy).map(link),
    blocking: openFirst(dependencies.blocking).map(link),
    comments,
    viewer,
  };
}

/** Every item of a plan once: epics, their stories, and every task. */
function planItems(view: PlanView): (PlanEpic | PlanStory | PlanTask)[] {
  return [...view.epics, ...view.epics.flatMap((e) => e.stories), ...view.epics.flatMap((e) => [...e.stories.flatMap((s) => s.tasks), ...e.tasks]), ...view.unparented];
}

const parentOf = (kind: "story" | "epic", item: PlanStory | PlanEpic): PlanParent => ({ kind, number: item.number, title: item.title, url: item.url, progress: item.progress });

/** Items in GitHub's sub-issue order; those GitHub did not list follow by number, as the plan sorts them. */
function inOrder<T extends { number: number }>(items: T[], order: number[]): T[] {
  const at = new Map(order.map((n, i) => [n, i]));
  return items.toSorted((a, b) => (at.get(a.number) ?? order.length + a.number) - (at.get(b.number) ?? order.length + b.number));
}

/** The timeline of one item and the items under it, with the arrows between them. */
function timelineOf(timeline: Timeline | undefined, numbers: number[]): Timeline | undefined {
  if (!timeline) return undefined;
  const keep = new Set(numbers);
  return { today: timeline.today, items: timeline.items.filter((i) => keep.has(i.number)), arrows: timeline.arrows.filter((a) => keep.has(a.from) && keep.has(a.to)) };
}

/**
 * The open blockers that hold an epic's tasks, the one that holds the most first, and how many of its
 * open tasks wait on one. Titles come from the plan, else from the repository's open issues.
 */
function waitingIn(epic: PlanEpic, view: PlanView, tasks: IssueTask[]): EpicWaiting {
  const open = tasks.filter((t) => t.state === "open");
  const holds = new Map<number, number>();
  for (const task of open) for (const blocker of task.blockedBy) holds.set(blocker, (holds.get(blocker) ?? 0) + 1);
  const known = new Map<number, { title: string; url: string; status: PlanStatus | undefined }>([
    ...view.unplanned.map((i) => [i.number, { title: i.title, url: i.url, status: undefined }] as const),
    ...planItems(view).map((i) => [i.number, { title: i.title, url: i.url, status: i.status }] as const),
  ]);
  const blockers = [...holds]
    .map(([number, blocks]) => ({ number, title: known.get(number)?.title ?? "", url: known.get(number)?.url ?? "", status: known.get(number)?.status, blocks }))
    .sort((a, b) => b.blocks - a.blocks || a.number - b.number);
  return { needsYou: tasks.filter((t) => t.needsYou).map((t) => t.number), waitingTasks: open.filter((t) => t.blockedBy.length > 0).length, blockers };
}

/** Where an issue sits in the plan, or undefined when it is not an item of it. */
function placeIn(view: PlanView, number: number, ctx: { waiting: Set<string>; order: number[] }): Planned | undefined {
  const mark = (task: PlanTask): IssueTask => ({ ...task, needsYou: task.run !== null && ctx.waiting.has(task.run.id) });
  const project = view.project;
  for (const epic of view.epics) {
    if (epic.number === number) {
      const stories = inOrder(epic.stories, ctx.order).map((s) => ({ ...s, tasks: s.tasks.map(mark) }));
      const tasks = epic.tasks.map(mark);
      const all = [...stories.flatMap((s) => s.tasks), ...tasks];
      const timeline = timelineOf(view.timeline, [epic.number, ...stories.map((s) => s.number)]);
      return { planned: true, kind: "epic", project, item: { ...epic, stories, tasks }, waiting: waitingIn(epic, view, all), timeline };
    }
    for (const story of epic.stories) {
      if (story.number === number) {
        const tasks = inOrder(story.tasks, ctx.order).map(mark);
        const timeline = timelineOf(view.timeline, [story.number, ...tasks.map((t) => t.number)]);
        return { planned: true, kind: "story", project, item: { ...story, tasks }, parents: [parentOf("epic", epic)], timeline };
      }
      const task = story.tasks.find((t) => t.number === number);
      if (task) return { planned: true, kind: "task", project, item: task, parents: [parentOf("story", story), parentOf("epic", epic)] };
    }
    const task = epic.tasks.find((t) => t.number === number);
    if (task) return { planned: true, kind: "task", project, item: task, parents: [parentOf("epic", epic)] };
  }
  const loose = view.unparented.find((t) => t.number === number);
  return loose ? { planned: true, kind: "task", project, item: loose, parents: [] } : undefined;
}

/** Every run whose linked issues include `number`, newest first, from handoff's own records. */
export async function issueRuns(db: Db, projectId: string, number: number): Promise<IssueRun[]> {
  const rows = await db
    .select({
      id: runs.id,
      status: runs.status,
      task: runs.task,
      issues: runs.issues,
      branch: runs.branchName,
      startedBy: runs.startedBy,
      createdAt: runs.createdAt,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      prNumber: runs.prNumber,
      graph: graphs.name,
      version: graphVersions.version,
    })
    .from(runs)
    .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(and(eq(runs.projectId, projectId), sql`${runs.issues} @> ${JSON.stringify([{ number }])}::jsonb`))
    .orderBy(desc(runs.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [lines, open, groups] = await Promise.all([
    runLines(db, ids),
    db
      .select({ id: questions.id, runId: questions.runId, question: questions.question, context: questions.context })
      .from(questions)
      .where(and(inArray(questions.runId, ids), isNull(questions.answer)))
      .orderBy(asc(questions.createdAt)),
    inboxGroups(db, { projectId }),
  ]);
  const waiting = waitingRuns({ ...groups, failedRuns: groups.failedRuns.map((f) => ({ ...f, error: f.error ?? null })) });
  return rows.flatMap(({ issues, ...run }) => {
    const line = lines.get(run.id);
    if (!line) return [];
    const asked = open.find((q) => q.runId === run.id);
    const context = (asked?.context ?? {}) as { review?: unknown; reason?: string };
    const waitingOn: RunWait | null = asked
      ? context.review
        ? { kind: "review", text: asked.question, href: reviewPath(projectId, run.id, asked.id) }
        : { kind: "question", text: asked.question, href: context.reason === "try" ? tryPath(projectId, run.id, asked.id) : runPath(projectId, run.id) }
      : null;
    const issueTitle = issues.find((i) => i.number === number)?.title ?? "";
    return [{ ...run, issueTitle, line, needsYou: waiting.has(run.id), waitingOn }];
  });
}
