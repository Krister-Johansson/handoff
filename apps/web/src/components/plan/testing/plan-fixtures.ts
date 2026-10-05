import type { Assignee, Milestone, PlanItem, PlanProject, PlanStatus } from "@handoff/github";
import type { BacklogIssue, BacklogRun } from "@/server/backlog";
import type { PlanColumn, PlanEpic, PlanProgress, PlanStory, PlanTask, PlanView } from "@/server/plan";
import { deriveSpans, type TimelineRun } from "@/lib/plan/schedule";
import { durationOf, type Forecasts } from "@/lib/plan/forecast";
import type { FlowInput, FlowRun } from "@/lib/plan/flow";
import { itemMilestones, milestoneProgress, type MilestoneJudge } from "@/lib/plan/milestones";
import type { SizingControl } from "../plan-context";

export const REPO_URL = "https://github.com/o/r";

/** A person on GitHub; the avatar defaults to one made from the login, and "" is none. */
export const person = (login: string, avatarUrl = `https://avatars.githubusercontent.com/${login}`): Assignee => ({ login, avatarUrl });

const item = (number: number, title: string, kind: PlanItem["kind"], over: Partial<PlanItem> = {}): PlanItem => ({
  number,
  title,
  url: `${REPO_URL}/issues/${number}`,
  state: "open",
  kind,
  status: "Shaping",
  parent: undefined,
  labels: kind ? [kind] : [],
  assignees: [],
  subIssues: { total: 0, completed: 0 },
  blockedBy: [],
  prNumbers: [],
  updatedAt: "2026-10-01T08:00:00Z",
  ...over,
});

export const task = (number: number, title: string, status: PlanStatus | undefined, over: Partial<PlanTask> = {}): PlanTask => ({
  ...item(number, title, "task", { status }),
  run: null,
  ...over,
});

export const run = (id: string, status: string, prNumber: number | null = null): BacklogRun => ({ id, status, prNumber });

const progress = (tasks: PlanTask[]): PlanProgress => {
  const byStatus = { Shaping: 0, Ready: 0, Running: 0, "In review": 0, Done: 0, Other: 0 } as Record<PlanColumn, number>;
  for (const t of tasks) byStatus[t.state === "closed" ? "Done" : (t.status ?? "Other")]++;
  return { done: byStatus.Done, total: tasks.length, byStatus, subIssues: { total: tasks.length, completed: byStatus.Done } };
};

export const story = (number: number, title: string, parent: number, tasks: PlanTask[], over: Partial<PlanItem> = {}): PlanStory => ({
  ...item(number, title, "story", { parent, ...over }),
  tasks: tasks.map((t) => ({ ...t, parent: t.parent ?? number })),
  progress: progress(tasks),
});

export const epic = (number: number, title: string, stories: PlanStory[], tasks: PlanTask[] = [], over: Partial<PlanItem> = {}): PlanEpic => ({
  ...item(number, title, "epic", over),
  stories,
  tasks,
  progress: progress([...stories.flatMap((s) => s.tasks), ...tasks]),
});

export const unplannedIssue = (number: number, title: string, over: Partial<BacklogIssue> = {}): BacklogIssue => ({
  number,
  title,
  url: `${REPO_URL}/issues/${number}`,
  labels: [],
  author: "ann",
  updatedAt: "2026-10-01T08:00:00Z",
  blockedBy: [],
  run: null,
  plan: { kind: undefined, status: undefined, planned: false },
  ...over,
});

export const PROJECT: PlanProject = {
  number: 5,
  url: "https://github.com/users/o/projects/5",
  title: "handoff plan",
  statusOptions: { Shaping: "s", Ready: "r", Running: "g", "In review": "i", Done: "d" },
};

/** A plan view from its epics, with the board built from every task the way loadPlan builds it. */
export function planView(epics: PlanEpic[], extra: { unparented?: PlanTask[]; unplanned?: BacklogIssue[] } = {}): PlanView {
  const tasks = [...epics.flatMap((e) => [...e.stories.flatMap((s) => s.tasks), ...e.tasks]), ...(extra.unparented ?? [])];
  const board = { Shaping: [], Ready: [], Running: [], "In review": [], Done: [], Other: [] } as Record<PlanColumn, PlanTask[]>;
  for (const t of [...tasks].sort((a, b) => a.number - b.number)) board[t.state === "closed" ? "Done" : (t.status ?? "Other")].push(t);
  return { project: PROJECT, epics, unparented: extra.unparented ?? [], board, unplanned: extra.unplanned ?? [] };
}

const itemsOfView = (view: Pick<PlanView, "epics" | "unparented">) => [...view.epics.flatMap((e) => [e, ...e.stories, ...e.stories.flatMap((s) => s.tasks), ...e.tasks]), ...view.unparented];

/** The timeline loadPlan would derive for a view: every epic, story and task, the runs given, at `now`. */
export function timelineOf(view: Pick<PlanView, "epics" | "unparented">, runs: TimelineRun[], now: Date) {
  return deriveSpans(itemsOfView(view), runs, now);
}

/** The timeline loadPlan derives with sizes: each task's duration from its estimate, Size or proposal at FORECASTS and 6 hours a day. */
export function sizedTimelineOf(view: Pick<PlanView, "epics" | "unparented">, runs: TimelineRun[], now: Date, capacity = 6) {
  const items = itemsOfView(view);
  const durations = new Map(
    items.flatMap((item) => {
      const duration = item.kind === "task" ? durationOf(item, FORECASTS, (item as PlanTask).proposal?.size) : undefined;
      return duration ? [[item.number, duration] as const] : [];
    }),
  );
  return deriveSpans(items, runs, now, { durations, capacity });
}

/** S and M from this project's runs, L on its default with three runs, as the design shows them. */
export const FORECASTS: Forecasts = {
  S: { size: "S", source: "runs", minutes: 25, parts: { agent: 15, queue: 3, waiting: 7 }, costUsd: 0.4, runs: 18, measuredMinutes: 25 },
  M: { size: "M", source: "runs", minutes: 50, parts: { agent: 30, queue: 5, waiting: 15 }, costUsd: 0.9, runs: 12, measuredMinutes: 50 },
  L: { size: "L", source: "default", minutes: 120, parts: null, costUsd: null, runs: 3, measuredMinutes: 110 },
};

/**
 * What loadPlan gives the Flow for a view: every item in Project order as listed (each epic, its stories, their
 * tasks and its own tasks, then the unparented tasks), one lane, Project order, the human skip label and the
 * default minutes per size, unless `over` says otherwise.
 */
export function flowOf(view: Pick<PlanView, "epics" | "unparented">, over: Partial<FlowInput> = {}): FlowInput {
  const items = itemsOfView(view).map((i, index) => ({ ...i, position: index + 1 }));
  return { tasks: items, runs: [], lanes: 1, order: "project", skipLabel: "human", latest: new Map(), held: [], pins: new Set(), minutes: { S: 30, M: 60, L: 120 }, ...over };
}

/** An active run of the Flow on an issue, created `minute` minutes into the day, with its steps done of its total. */
export const flowRun = (issue: number, minute: number, done: number, total: number, over: Partial<FlowRun> = {}): FlowRun => ({
  issue,
  runId: `${String(issue).padStart(8, "0")}-0000-4000-8000-000000000000`,
  createdAt: new Date(Date.UTC(2026, 9, 3, 8, minute)),
  progress: { done, total },
  ...over,
});

/** What the size chips read from the Plan page: project p1 named todooverkill at 6 hours a day. */
export const sizingOf = (over: Partial<SizingControl> = {}): SizingControl => ({
  projectId: "p1",
  projectName: "todooverkill",
  mode: "timeline",
  forecasts: FORECASTS,
  capacity: 6,
  spanOf: () => undefined,
  ...over,
});

/** A milestone of o/r, open and without a due date unless `over` says otherwise. */
export const milestone = (number: number, title: string, over: Partial<Milestone> = {}): Milestone => ({
  number,
  title,
  description: "",
  dueOn: undefined,
  state: "open",
  openIssues: 0,
  closedIssues: 0,
  url: `${REPO_URL}/milestone/${number}`,
  ...over,
});

/**
 * The view as loadPlan gives it with milestones: each epic, story and task carries its milestone, its own (set with
 * `milestone` on the item) or the one it inherits, and the view has `milestones` with their progress, judged by
 * `judge`, and `noMilestone`.
 */
export function withMilestones(view: PlanView, milestones: Milestone[], judge: MilestoneJudge = {}): PlanView {
  const items = itemsOfView(view);
  const of = itemMilestones(items);
  const mark = <T extends PlanItem>(i: T): T => ({ ...i, milestone: of.get(i.number) });
  const epics = view.epics.map((e) => ({ ...mark(e), stories: e.stories.map((s) => ({ ...mark(s), tasks: s.tasks.map(mark) })), tasks: e.tasks.map(mark) }));
  const unparented = view.unparented.map(mark);
  const board = Object.fromEntries(Object.entries(view.board).map(([c, tasks]) => [c, tasks.map(mark)])) as Record<PlanColumn, PlanTask[]>;
  const progress = milestoneProgress(milestones, items, judge);
  return { ...view, epics, unparented, board, milestones: progress.milestones, noMilestone: progress.none };
}
