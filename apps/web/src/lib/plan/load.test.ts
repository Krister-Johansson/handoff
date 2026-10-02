import { expect, test } from "vitest";
import type { PlanItem } from "@handoff/github";
import { loadByDay } from "./load";

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

const hours = (entries: Record<number, number>) => new Map(Object.entries(entries).map(([n, h]) => [Number(n), { hours: h }]));

test("planned hours per day count every scheduled task with a duration, spread over its days", () => {
  const items = [
    // Nine hours from the 12th at 6 a day: 6 on the 12th and 3 on the 13th.
    item(1, { start: "2026-10-12" }),
    // After #1 on the 12th, so its 2 hours fall on the 13th.
    item(2, { start: "2026-10-12" }),
    // The 13th's own task adds 4 more: 9 hours, over the capacity.
    item(3, { start: "2026-10-13" }),
    // A done task still counts.
    item(4, { state: "closed", status: "Done", start: "2026-10-10" }),
    // A duration without a Start places nothing.
    item(5),
    // Tasks with dates and no duration are counted apart; a story is not a task.
    item(6, { start: "2026-10-12", target: "2026-10-14" }),
    item(7, { target: "2026-10-20" }),
    item(8, { kind: "story", start: "2026-10-12", target: "2026-10-20" }),
  ];
  expect(loadByDay(items, hours({ 1: 9, 2: 2, 3: 4, 4: 1, 5: 3 }), 6)).toEqual({
    hours: { "2026-10-10": 1, "2026-10-12": 6, "2026-10-13": 9 },
    datedWithoutDuration: 2,
  });
});
