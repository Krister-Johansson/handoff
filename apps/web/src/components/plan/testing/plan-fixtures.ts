import type { Assignee, PlanItem, PlanProject, PlanStatus } from "@handoff/github";
import type { BacklogIssue, BacklogRun } from "@/server/backlog";
import type { PlanColumn, PlanEpic, PlanProgress, PlanStory, PlanTask, PlanView } from "@/server/plan";
import { deriveSpans, type TimelineRun } from "@/lib/plan/schedule";
import type { Forecasts } from "@/lib/plan/forecast";
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

/** The timeline loadPlan would derive for a view: every epic, story and task, the runs given, at `now`. */
export function timelineOf(view: Pick<PlanView, "epics" | "unparented">, runs: TimelineRun[], now: Date) {
  const items = [...view.epics.flatMap((e) => [e, ...e.stories, ...e.stories.flatMap((s) => s.tasks), ...e.tasks]), ...view.unparented];
  return deriveSpans(items, runs, now);
}

/** S and M from this project's runs, L on its default with three runs, as the design shows them. */
export const FORECASTS: Forecasts = {
  S: { size: "S", source: "runs", minutes: 25, parts: { agent: 15, queue: 3, waiting: 7 }, costUsd: 0.4, runs: 18, measuredMinutes: 25 },
  M: { size: "M", source: "runs", minutes: 50, parts: { agent: 30, queue: 5, waiting: 15 }, costUsd: 0.9, runs: 12, measuredMinutes: 50 },
  L: { size: "L", source: "default", minutes: 120, parts: null, costUsd: null, runs: 3, measuredMinutes: 110 },
};

/** What the size chips read from the Plan page: project p1 named todooverkill at 6 hours a day. */
export const sizingOf = (over: Partial<SizingControl> = {}): SizingControl => ({
  projectId: "p1",
  projectName: "todooverkill",
  forecasts: FORECASTS,
  capacity: 6,
  spanOf: () => undefined,
  ...over,
});
