import { expect, test } from "vitest";
import type { PlanItem } from "@handoff/github";
import { candidates, type IssueRun } from "./candidates.ts";

/** A plan item as listItems returns it: an open task in Ready with no blockers, unless `over` says otherwise. */
function item(number: number, over: Partial<PlanItem> = {}): PlanItem {
  return {
    number,
    title: `Task ${number}`,
    url: `https://github.com/octo/sample/issues/${number}`,
    state: "open",
    kind: "task",
    status: "Ready",
    parent: undefined,
    labels: ["task"],
    assignees: [],
    subIssues: { total: 0, completed: 0 },
    blockedBy: [],
    prNumbers: [],
    updatedAt: "",
    position: number,
    ...over,
  };
}

const none = new Map<number, IssueRun>();
const numbers = (list: { number: number }[]) => list.map((c) => c.number);

test("only open Ready tasks without open blockers and without an active run are candidates, in Project order", () => {
  const items = [
    item(5, { position: 1 }),
    item(3, { position: 2, blockedBy: [5] }),
    item(9, { position: 4, state: "closed" }),
    item(4, { position: 7 }),
    item(1, { position: 9 }),
  ];
  const runs = new Map<number, IssueRun>([[4, { id: "4a4a4a4a-0000-0000-0000-000000000000", status: "waiting" }]]);

  const result = candidates(items, runs, { order: "project" });

  expect(numbers(result.candidates)).toEqual([5, 1]);
  expect(result.skipped).toEqual([
    { number: 3, title: "Task 3", reason: "blocked by #5" },
    { number: 4, title: "Task 4", reason: "taken by run 4a4a4a4a" },
  ]);
});

test("epics, stories, Shaping tasks and unplanned issues are never candidates", () => {
  const items = [
    item(1, { kind: "epic" }),
    item(2, { kind: "story" }),
    item(3, { status: "Shaping" }),
    item(4, { status: undefined }),
    item(5, { kind: undefined }),
    item(6),
  ];

  // An open issue outside the Project has no item, so it can never be named.
  const result = candidates(items, none, { order: "project" });

  expect(numbers(result.candidates)).toEqual([6]);
  expect(result.skipped).toEqual([]);
});

test("priority order puts the first option first, items without a value last, and keeps Project order within a priority", () => {
  const items = [
    item(1, { position: 1 }),
    item(2, { position: 3, priority: "P2" }),
    item(3, { position: 4, priority: "P0" }),
    item(4, { position: 6 }),
    item(5, { position: 8, priority: "P2" }),
    item(6, { position: 11, priority: "P0" }),
    item(7, { position: 12, priority: "P1" }),
  ];

  const byPriority = candidates(items, none, { order: "priority", priorityOptions: ["P0", "P1", "P2"] });
  const byProject = candidates(items, none, { order: "project", priorityOptions: ["P0", "P1", "P2"] });

  expect(numbers(byPriority.candidates)).toEqual([3, 6, 7, 2, 5, 1, 4]);
  expect(numbers(byProject.candidates)).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

test("a task whose latest run was cancelled is skipped with the reason", () => {
  const items = [item(1), item(2), item(3)];
  const runs = new Map<number, IssueRun>([
    [1, { id: "11111111-0000-0000-0000-000000000000", status: "cancelled" }],
    [2, { id: "22222222-0000-0000-0000-000000000000", status: "succeeded" }],
  ]);

  const result = candidates(items, runs, { order: "project" });

  expect(numbers(result.candidates)).toEqual([2, 3]);
  expect(result.skipped).toEqual([{ number: 1, title: "Task 1", reason: "cancelled run; start it by hand" }]);
});

test("a task with the skip label is skipped with the reason, and no skip label skips none", () => {
  const items = [item(1, { labels: ["task", "human"] }), item(2)];

  const skipping = candidates(items, none, { order: "project", skipLabel: "human" });
  const all = candidates(items, none, { order: "project", skipLabel: null });

  expect(numbers(skipping.candidates)).toEqual([2]);
  expect(skipping.skipped).toEqual([{ number: 1, title: "Task 1", reason: "labelled human" }]);
  expect(numbers(all.candidates)).toEqual([1, 2]);
});

test("a task whose cancelled run a person let the scheduler take is a candidate again", () => {
  const cancelled = "11111111-0000-0000-0000-000000000000";
  const items = [item(1), item(2, { position: 0 })];
  const runs = new Map<number, IssueRun>([
    [1, { id: cancelled, status: "cancelled" }],
    [2, { id: "22222222-0000-0000-0000-000000000000", status: "cancelled" }],
  ]);

  const result = candidates(items, runs, { order: "project", released: new Set([cancelled]) });

  expect(numbers(result.candidates)).toEqual([1]);
  expect(result.skipped).toEqual([{ number: 2, title: "Task 2", reason: "cancelled run; start it by hand" }]);
});
