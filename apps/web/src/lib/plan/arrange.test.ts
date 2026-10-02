import { expect, test } from "vitest";
import { arrange, type ArrangeTask } from "./arrange";

/** A task with its duration in hours and the issues that block it. */
const task = (number: number, hours: number | undefined, over: Partial<ArrangeTask> = {}): ArrangeTask => ({ number, blockers: [], hours, ...over });

const TODAY = "2026-10-10";

test("arrange fills days from today up to the capacity after planned work, in blocker order", () => {
  const planned = [
    // Four hours on today and a full day on the 12th are already planned.
    task(1, 4, { start: "2026-10-10" }),
    task(2, 6, { start: "2026-10-12" }),
    // Planned work in the past takes nothing from today.
    task(3, 6, { start: "2026-10-01" }),
  ];
  const tasks = [task(20, 3), task(21, 2, { blockers: [22] }), task(22, 4), task(23, 1)];
  expect(arrange(tasks, planned, 6, TODAY)).toEqual({
    placements: [
      // Today's last 2 hours, then 1 hour into the 11th.
      { issue: 20, start: "2026-10-10", target: "2026-10-11" },
      // Today is full: the 11th, beside #20's last hour.
      { issue: 22, start: "2026-10-11", target: "2026-10-11" },
      // After its blocker #22, but the 11th would go over 6 hours and the 12th is full.
      { issue: 21, start: "2026-10-13", target: "2026-10-13" },
      // The 11th's last free hour, after #22.
      { issue: 23, start: "2026-10-11", target: "2026-10-11" },
    ],
    leftOut: [],
  });
  // Planned bars stay where they are: on the 10th #20 would sit before #90 by number and push it later.
  expect(arrange([task(20, 1)], [task(90, 2, { start: "2026-10-10" })], 6, TODAY).placements).toEqual([{ issue: 20, start: "2026-10-11", target: "2026-10-11" }]);
});

test("a task starts no earlier than its placed blockers end", () => {
  const planned = [
    // Nine hours from today: it ends three hours into the 11th.
    task(1, 9, { start: "2026-10-10" }),
    // Dates and no duration: it ends with its Target day.
    task(2, undefined, { start: "2026-10-10", target: "2026-10-14" }),
  ];
  const tasks = [
    task(30, 1, { blockers: [1] }),
    task(31, 1, { blockers: [2] }),
    task(32, 2, { blockers: [33] }),
    task(33, 5),
    // #35 is neither planned nor arranged, so it holds nothing back.
    task(34, 1, { blockers: [35] }),
  ];
  expect(arrange(tasks, planned, 6, TODAY).placements).toEqual([
    // The 11th has room, but #1 runs into it.
    { issue: 30, start: "2026-10-12", target: "2026-10-12" },
    { issue: 31, start: "2026-10-15", target: "2026-10-15" },
    { issue: 33, start: "2026-10-12", target: "2026-10-12" },
    // #33 fills the 12th, so its blocked task starts on the 13th although the 11th has room.
    { issue: 32, start: "2026-10-13", target: "2026-10-13" },
    { issue: 34, start: "2026-10-11", target: "2026-10-11" },
  ]);
});

test("tasks without a duration are left out with the reason", () => {
  // #41 waits on #40, which Arrange cannot place, so nothing holds #41 back.
  const tasks = [task(40, undefined), task(41, 2, { blockers: [40] }), task(42, undefined)];
  expect(arrange(tasks, [], 6, TODAY)).toEqual({
    placements: [{ issue: 41, start: "2026-10-10", target: "2026-10-10" }],
    leftOut: [
      { issue: 40, reason: "no-duration" },
      { issue: 42, reason: "no-duration" },
    ],
  });
});
