import type { IssueDetail } from "@handoff/github";
import type { FoundIssue, IssueRun, IssueTask } from "@/server/issue-page";
import { epic, PROJECT, story, task } from "@/components/plan/testing/plan-fixtures";

export const NOW = new Date("2026-10-02T16:42:00Z");
export const REPO = "Krister-Johansson/todoOverKill";
export const REPO_URL = `https://github.com/${REPO}`;
export const PROJECT_REF = { id: "p1", name: "todooverkill", repo: REPO };
export const START = { graphs: ["master"], graphName: "master" };

export const issueDetail = (number: number, title: string, over: Partial<IssueDetail> = {}): IssueDetail => ({
  number,
  title,
  url: `${REPO_URL}/issues/${number}`,
  body: "",
  state: "open",
  stateReason: null,
  labels: [],
  assignees: [],
  author: "Krister-Johansson",
  authorAssociation: "OWNER",
  createdAt: "2026-09-30T09:00:00Z",
  updatedAt: "2026-10-02T14:00:00Z",
  pullRequest: false,
  ...over,
});

/** Run 64fde8ef on #16, waiting at human_gate-1 for a review of the plan. */
export function waitingRun(over: Partial<IssueRun> = {}): IssueRun {
  return {
    id: "64fde8ef-0000-4000-8000-000000000001",
    status: "waiting",
    task: "#16 F16 Drag and drop on the board",
    graph: "master",
    version: 3,
    branch: "handoff/16-f16-drag-and-drop-on-the-board-64fde8ef",
    startedBy: "dashboard",
    createdAt: new Date("2026-10-02T14:08:00Z"),
    startedAt: new Date("2026-10-02T14:08:00Z"),
    finishedAt: null,
    prNumber: null,
    issueTitle: "F16 Drag and drop on the board",
    line: {
      graph: "master",
      version: 3,
      costUsd: 1.2,
      now: { tone: "attention", text: "human_gate-1 waits for your review" },
      reviewHref: "/projects/p1/runs/64fde8ef-0000-4000-8000-000000000001/review/q1",
      steps: [
        { nodeKey: "start", status: "passed", times: 1 },
        { nodeKey: "planner-1", status: "passed", times: 3 },
        { nodeKey: "reviewer-1", status: "passed", times: 3 },
        { nodeKey: "human_gate-1", status: "waiting", times: 1 },
      ],
      stepSince: new Date("2026-10-02T14:22:00Z"),
    },
    needsYou: true,
    waitingOn: { kind: "review", text: "Review the plan from planner-1", href: "/projects/p1/runs/64fde8ef-0000-4000-8000-000000000001/review/q1" },
    assigned: "Krister-Johansson",
    ...over,
  };
}

const mark = (t: ReturnType<typeof task>, needsYou = false): IssueTask => ({ ...t, needsYou });

const drag = task(16, "F16 Drag and drop on the board", "Running", {
  blockedBy: [145],
  blockers: [145, 15, 8],
  run: { id: "64fde8ef-0000-4000-8000-000000000001", status: "waiting", prNumber: null },
  start: "2026-09-30",
  target: "2026-10-07",
});
const reorder = task(88, "F62 Reorder subtasks and show progress on board cards", "Ready", { blockedBy: [145, 148], start: "2026-10-05", target: "2026-10-09" });
export const STORY = story(132, "Board interactions and subtask order", 121, [drag, reorder]);
export const EPIC = epic(121, "Projects and tasks: finish Milestone 1", [STORY], [], { start: "2026-09-28", target: "2026-10-30" });

/** Task #16 of todooverkill: Running, blocked by #145 (open) and #15 and #8 (closed), with three comments. */
export function taskPage(over: Partial<FoundIssue> = {}): FoundIssue {
  return {
    state: "found",
    section: "plan",
    kind: "task",
    issue: issueDetail(16, "F16 Drag and drop on the board", {
      body: "`@dnd-kit` with pointer and keyboard sensors.\nDepends on: #15 (F15), #8 (F08)",
      labels: ["projects-tasks", "task"],
      assignees: ["Krister-Johansson"],
    }),
    place: {
      planned: true,
      kind: "task",
      project: PROJECT,
      item: drag,
      parents: [
        { kind: "story", number: 132, title: STORY.title, url: STORY.url, progress: STORY.progress },
        { kind: "epic", number: 121, title: EPIC.title, url: EPIC.url, progress: EPIC.progress },
      ],
    },
    blockedBy: [
      { number: 145, title: "R5 Restyle board columns and task cards", url: `${REPO_URL}/issues/145`, state: "open", status: "Ready" },
      { number: 15, title: 'F15 Move task with a "Move to" menu and keyboard', url: `${REPO_URL}/issues/15`, state: "closed", status: "Done" },
      { number: 8, title: "F08 Theme switch and motion preferences", url: `${REPO_URL}/issues/8`, state: "closed", status: "Done" },
    ],
    blocking: [],
    comments: [
      {
        id: 1,
        author: "Krister-Johansson",
        authorAssociation: "OWNER",
        createdAt: "2026-10-01T22:17:00Z",
        updatedAt: "2026-10-01T22:17:00Z",
        body: "Notes from the code review of F15.",
        url: `${REPO_URL}/issues/16#issuecomment-1`,
      },
    ],
    pulls: [],
    viewer: "Krister-Johansson",
    ...over,
  };
}

/** Story #132 with #16 (Running, its run needs you) and #88 (Ready, blocked), GitHub keeping #16 first. */
export function storyPage(): FoundIssue {
  return {
    ...taskPage(),
    kind: "story",
    issue: issueDetail(132, STORY.title, { labels: ["story"], body: "## Acceptance criteria\n\n- [ ] Cards can be dragged\n\n## Tasks\n\n- [ ] #16\n- [ ] #88" }),
    place: {
      planned: true,
      kind: "story",
      project: PROJECT,
      item: { ...STORY, tasks: [mark(drag, true), mark(reorder)] },
      parents: [{ kind: "epic", number: 121, title: EPIC.title, url: EPIC.url, progress: EPIC.progress }],
      timeline: undefined,
    },
    blockedBy: [],
    comments: [],
  };
}

/** Epic #121 with story #132, its own dates, and #145 holding its tasks. */
export function epicPage(): FoundIssue {
  return {
    ...taskPage(),
    kind: "epic",
    issue: issueDetail(121, EPIC.title, { labels: ["epic"], body: "## Goal\n\nFinish the open Milestone 1 work." }),
    place: {
      planned: true,
      kind: "epic",
      project: PROJECT,
      item: { ...EPIC, stories: [{ ...STORY, tasks: [mark(drag, true), mark(reorder)] }], tasks: [] },
      waiting: {
        needsYou: [16],
        waitingTasks: 2,
        blockers: [
          { number: 145, title: "R5 Restyle board columns and task cards", url: `${REPO_URL}/issues/145`, status: "Ready", blocks: 2 },
          { number: 148, title: "R8 Restyle the task page", url: `${REPO_URL}/issues/148`, status: "Shaping", blocks: 1 },
        ],
      },
      timeline: undefined,
    },
    blockedBy: [],
    comments: [],
  };
}

/** handoff #407, outside the plan, with no labels, no assignee and no comments. */
export function unplannedPage(): FoundIssue {
  return {
    ...taskPage(),
    section: "issues",
    kind: "issue",
    issue: issueDetail(407, "A task added to the plan while its run is active lands in Shaping", { body: "Run 64fde8ef on todooverkill #16 started at 14:08 UTC." }),
    place: { planned: false, reason: undefined, error: undefined, project: { ...PROJECT, title: "handoff plan" }, stories: [{ number: 132, title: STORY.title, epic: EPIC.title }] },
    blockedBy: [],
    comments: [],
  };
}
