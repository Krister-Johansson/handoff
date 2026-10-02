import { expect, test } from "vitest";
import type { PlanItem } from "@handoff/github";
import { deriveSpans, type TimelineRun } from "./schedule";

/** A plan item with nothing set but what the test gives. */
function item(number: number, over: Partial<PlanItem> = {}): PlanItem {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/octo/sample/issues/${number}`,
    state: "open",
    kind: "task",
    status: "Ready",
    parent: undefined,
    labels: [],
    assignees: [],
    subIssues: { total: 0, completed: 0 },
    blockedBy: [],
    prNumbers: [],
    updatedAt: "2026-10-01T10:00:00Z",
    ...over,
  };
}

// Noon local time on Saturday 10 October 2026: "today" is 2026-10-10 in any time zone a test runs in.
const NOW = new Date(2026, 9, 10, 12, 0, 0);

const spanOf = (items: PlanItem[], number: number, runs: TimelineRun[] = []) => deriveSpans(items, runs, NOW).items.find((i) => i.number === number)!;

test("a task's planned span is its Start to Target and a one-sided date gives a one-day span marked open on the missing side", () => {
  const items = [item(1, { start: "2026-10-06", target: "2026-10-09" }), item(2, { start: "2026-10-12" }), item(3, { target: "2026-10-16" }), item(4)];
  expect(spanOf(items, 1).planned).toEqual({ start: "2026-10-06", end: "2026-10-09", openStart: false, openEnd: false });
  expect(spanOf(items, 2).planned).toEqual({ start: "2026-10-12", end: "2026-10-12", openStart: false, openEnd: true });
  expect(spanOf(items, 3).planned).toEqual({ start: "2026-10-16", end: "2026-10-16", openStart: true, openEnd: false });
  expect(spanOf(items, 4)).toMatchObject({ planned: undefined, unscheduled: true });
  expect(spanOf(items, 1).unscheduled).toBe(false);
});

test("a story without dates derives its span from its tasks and a story with dates keeps them and flags a task outside its window", () => {
  const items = [
    item(10, { kind: "story" }),
    item(11, { parent: 10, start: "2026-10-06", target: "2026-10-09" }),
    item(12, { parent: 10, start: "2026-10-12", target: "2026-10-20" }),
    // Only a Start: it counts toward the earliest start, not the latest end.
    item(13, { parent: 10, start: "2026-10-05" }),
    item(20, { kind: "story", start: "2026-10-12", target: "2026-10-23" }),
    item(21, { parent: 20, start: "2026-10-12", target: "2026-10-16" }),
    item(22, { parent: 20, start: "2026-10-19", target: "2026-10-27" }),
  ];
  expect(spanOf(items, 10)).toMatchObject({ planned: undefined, derived: { start: "2026-10-05", end: "2026-10-20" }, unscheduled: false });
  expect(spanOf(items, 20)).toMatchObject({ planned: { start: "2026-10-12", end: "2026-10-23" }, derived: undefined });
  expect([spanOf(items, 21).outsideParent, spanOf(items, 22).outsideParent]).toEqual([false, true]);
  // A story without its own dates sets no window, so its tasks are never outside it.
  expect(spanOf(items, 12).outsideParent).toBe(false);
});

test("an epic without any dated descendant has no span and is unscheduled", () => {
  const items = [item(1, { kind: "epic" }), item(2, { kind: "story", parent: 1 }), item(3, { parent: 2 }), item(4, { kind: "epic" }), item(5, { kind: "story", parent: 4 }), item(6, { parent: 5, target: "2026-11-02" })];
  expect(spanOf(items, 1)).toMatchObject({ planned: undefined, derived: undefined, unscheduled: true });
  // A dated grandchild gives an epic its span through the story between them.
  expect(spanOf(items, 4)).toMatchObject({ derived: { start: "2026-11-02", end: "2026-11-02" }, unscheduled: false });
});

test("actual strips come from each run's start and end, an active run ends today, newest first", () => {
  const items = [item(1), item(2)];
  const runs: TimelineRun[] = [
    { id: "run-old", status: "cancelled", issues: [1], startedAt: "2026-10-05T09:00:00.000Z", finishedAt: "2026-10-05T11:00:00.000Z" },
    { id: "run-now", status: "running", issues: [1, 2], startedAt: "2026-10-09T08:00:00.000Z", finishedAt: null },
    // A queued run has not started: it has no strip yet.
    { id: "run-queued", status: "queued", issues: [1], startedAt: null, finishedAt: null },
    // A run on an issue outside the plan draws nothing.
    { id: "run-elsewhere", status: "succeeded", issues: [99], startedAt: "2026-10-01T08:00:00.000Z", finishedAt: "2026-10-01T09:00:00.000Z" },
  ];
  expect(spanOf(items, 1, runs).actual).toEqual([
    { runId: "run-now", status: "running", start: "2026-10-09T08:00:00.000Z", end: NOW.toISOString(), active: true },
    { runId: "run-old", status: "cancelled", start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T11:00:00.000Z", active: false },
  ]);
  expect(spanOf(items, 2, runs).actual.map((s) => s.runId)).toEqual(["run-now"]);
});

test("a task is late when today is past its Start and a blocker is not done, and overdue when today is past its Target and it is not done", () => {
  const items = [
    item(1, { status: "Running" }),
    // Closed, so done whatever its Status says.
    item(2, { state: "closed", status: "In review" }),
    item(3, { start: "2026-10-08", blockedBy: [1], blockers: [1, 2] }),
    // Its Start is today, not past: blocked, but not late yet.
    item(4, { start: "2026-10-10", blockedBy: [1], blockers: [1] }),
    item(5, { start: "2026-10-01", blockers: [2] }),
    item(6, { start: "2026-09-28", target: "2026-10-07" }),
    item(7, { start: "2026-09-28", target: "2026-10-07", status: "Done" }),
    // A blocker outside the plan counts as not done while GitHub lists it as open.
    item(8, { start: "2026-10-01", blockedBy: [70], blockers: [70, 71] }),
  ];
  expect(spanOf(items, 3)).toMatchObject({ late: true, waitingOn: [1] });
  expect(spanOf(items, 4)).toMatchObject({ late: false, waitingOn: [1] });
  expect(spanOf(items, 5)).toMatchObject({ late: false, waitingOn: [] });
  expect(spanOf(items, 6)).toMatchObject({ overdueDays: 3, late: false });
  expect(spanOf(items, 7).overdueDays).toBeUndefined();
  expect(spanOf(items, 8)).toMatchObject({ late: true, waitingOn: [70] });
});

test("arrows run from each blocker to the blocked task and are red when the task is late", () => {
  const items = [item(1, { status: "Running" }), item(2, { state: "closed" }), item(3, { start: "2026-10-08", blockedBy: [1], blockers: [1, 2] }), item(4, { start: "2026-10-20", blockedBy: [1], blockers: [1, 60] })];
  expect(deriveSpans(items, [], NOW).arrows).toEqual([
    { from: 1, to: 3, late: true },
    { from: 2, to: 3, late: true },
    // #60 is not in the plan: it has no row to start an arrow from.
    { from: 1, to: 4, late: false },
  ]);
});

/** Durations by issue number, in hours. */
const hours = (entries: Record<number, number>) => new Map(Object.entries(entries).map(([n, h]) => [Number(n), { hours: h }]));

test("a sized task's bar runs from Start for its duration over the capacity", () => {
  const items = [
    // GitHub's Target disagrees with Start plus 9 hours: the bar follows the duration and keeps GitHub's Target for the hover.
    item(1, { start: "2026-10-12", target: "2026-10-20" }),
    item(2, { start: "2026-10-14" }),
    item(3, { start: "2026-10-15", target: "2026-10-17" }),
    // No duration: Start to Target as before.
    item(4, { start: "2026-10-12", target: "2026-10-14" }),
  ];
  const durations = hours({ 1: 9, 2: 50 / 60, 3: 13 });
  const at = (capacity: number) => deriveSpans(items, [], NOW, { durations, capacity }).items;
  expect(at(6).map((i) => i.planned)).toEqual([
    { start: "2026-10-12", end: "2026-10-13", openStart: false, openEnd: false, hours: 9, offsetHours: 0, targetOnGitHub: "2026-10-20" },
    { start: "2026-10-14", end: "2026-10-14", openStart: false, openEnd: false, hours: 50 / 60, offsetHours: 0 },
    { start: "2026-10-15", end: "2026-10-17", openStart: false, openEnd: false, hours: 13, offsetHours: 0 },
    { start: "2026-10-12", end: "2026-10-14", openStart: false, openEnd: false },
  ]);
  // At 8 hours a day the 13-hour task takes two days, and GitHub's Target of the 17th no longer agrees.
  expect(at(8)[2]!.planned).toEqual({ start: "2026-10-15", end: "2026-10-16", openStart: false, openEnd: false, hours: 13, offsetHours: 0, targetOnGitHub: "2026-10-17" });
  // Overdue still reads GitHub's Target.
  expect(deriveSpans([item(5, { start: "2026-10-01", target: "2026-10-07" })], [], NOW, { durations: hours({ 5: 1 }), capacity: 6 }).items[0]).toMatchObject({
    planned: { start: "2026-10-01", end: "2026-10-01", targetOnGitHub: "2026-10-07" },
    overdueDays: 3,
  });
});
