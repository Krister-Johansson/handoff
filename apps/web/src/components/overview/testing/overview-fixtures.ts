import type { InboxView } from "@/components/inbox/inbox-view";
import type { Overview, OverviewRun } from "@/server/overview";
import type { PlanProgress, PlanTask } from "@/server/plan";

export const NOW = new Date("2026-10-02T12:00:00Z");
export const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

export const EMPTY_INBOX: InboxView = { reviews: [], questions: [], failedRuns: [], stuckRuns: [], pullRequests: [], readyToMerge: [], permissions: [] };

/** A run as the Overview lists it; a coder at work unless told otherwise. */
export function run(overrides: Partial<OverviewRun> & { id: string; task: string }): OverviewRun {
  return {
    projectId: "p1",
    issues: [],
    status: "running",
    branchName: "handoff/branch",
    prNumber: null,
    createdAt: minutesAgo(14),
    finishedAt: null,
    project: "handoff",
    repo: "handoff",
    owner: "Krister-Johansson",
    needsYou: false,
    line: { graph: "plan-review", version: 11, costUsd: 1.84, now: { tone: "active", text: "Coder is working" }, steps: [], stepSince: null },
    ...overrides,
  };
}

/** A plan task in the given status, open, without a run. */
export function task(number: number, title: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    number,
    title,
    url: `https://github.com/Krister-Johansson/handoff/issues/${number}`,
    state: "open",
    kind: "task",
    status: "Ready",
    parent: undefined,
    labels: ["task"],
    assignees: [],
    subIssues: { total: 0, completed: 0 },
    blockedBy: [],
    prNumbers: [],
    updatedAt: "2026-10-01T10:00:00Z",
    run: null,
    ...overrides,
  };
}

export const progress = (byStatus: Partial<PlanProgress["byStatus"]>): PlanProgress => {
  const all = { Shaping: 0, Ready: 0, Running: 0, "In review": 0, Done: 0, Other: 0, ...byStatus };
  const total = Object.values(all).reduce((a, b) => a + b, 0);
  return { done: all.Done, total, byStatus: all, subIssues: { total, completed: all.Done } };
};

/** A quiet project with a plan: nothing waits, runs or finished, no features, nothing ready. */
export const QUIET: Overview = {
  needsYou: EMPTY_INBOX,
  running: [],
  finished: [],
  work: {
    kind: "plan",
    project: { number: 5, url: "https://github.com/users/Krister-Johansson/projects/5", title: "handoff plan", statusOptions: { Shaping: "a", Ready: "b", Running: "c", "In review": "d", Done: "e" } },
    features: [],
    ready: [],
    unplannedToDo: 0,
  },
};
