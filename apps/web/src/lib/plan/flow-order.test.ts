import { expect, test } from "vitest";
import { afterBlockers, blockersFirst, carryDependents, fillPlaces, keepPins, moveTo, placeMoves, ruleBreaks } from "./flow-order";

test("next free slot puts the task right after its last blocker in the queue", () => {
  // #62 was dropped first. #61 and #58 block it, and #50 is running, so it is not in the queue.
  const blockers = new Map([[62, [50, 61, 58]]]);

  expect(afterBlockers([62, 58, 61, 59, 60], 62, blockers)).toEqual([58, 61, 62, 59, 60]);
  // A task already after its blockers stays where it is.
  expect(afterBlockers([58, 61, 59, 62, 60], 62, blockers)).toEqual([58, 61, 59, 62, 60]);
});

test("blockers first moves the open blockers, with their own blockers, to just before the task", () => {
  // #61 blocks #62, #60 blocks #61 though it sits after it, and #57 blocks #60 from the front of the queue.
  const blockers = new Map([
    [62, [61, 50]],
    [61, [60]],
    [60, [57]],
  ]);

  // #62 is dropped at Next 2. #60 and #61 come with it, in blocker order; #57 already sits earlier.
  expect(blockersFirst([57, 58, 61, 59, 60, 62], 62, 1, blockers)).toEqual([57, 60, 61, 62, 58, 59]);
});

test("keep it here leaves the task where it was dropped and ruleBreaks names its blocker", () => {
  // #61 blocks #62, #58 blocks #63, and #50 is running.
  const blockers = new Map([
    [62, [61, 50]],
    [63, [58]],
  ]);
  const kept = moveTo([58, 61, 62, 63], 62, 0);

  expect(kept).toEqual([62, 58, 61, 63]);
  expect(ruleBreaks(kept, blockers)).toEqual([{ issue: 62, waitsFor: [61] }]);
  expect(ruleBreaks([58, 61, 62, 63], blockers)).toEqual([]);
});

test("carrying dependents moves the tasks it blocks that now sit before it to right after it, in their order", () => {
  // #62 blocks #63, #64 and #67; #63 blocks #65.
  const blocks = new Map([
    [62, [63, 64, 67]],
    [63, [65]],
  ]);
  const dropped = moveTo([61, 62, 63, 66, 65, 64, 67], 62, 5);

  expect(dropped).toEqual([61, 63, 66, 65, 64, 62, 67]);
  // #63, #65 and #64 follow #62 in the order they had; #66 does not wait on it, and #67 already sits after it.
  expect(carryDependents(dropped, 62, blocks, new Set())).toEqual([61, 66, 62, 63, 65, 64, 67]);
});

test("a pinned dependent is not carried and gets the warning", () => {
  // #62 blocks #63, which a person pinned, and #64.
  const blockers = new Map([
    [63, [62]],
    [64, [62]],
  ]);
  const blocks = new Map([[62, [63, 64]]]);
  const carried = carryDependents(moveTo([61, 62, 63, 64], 62, 3), 62, blocks, new Set([63]));

  expect(carried).toEqual([61, 63, 62, 64]);
  expect(ruleBreaks(carried, blockers)).toEqual([{ issue: 63, waitsFor: [62] }]);
});

test("keepPins puts each pinned task back at its place number", () => {
  // #2 and #5 are pinned at Next 2 and Next 5; #9 is pinned but closed, so it is not in the queue.
  const pins = new Set([2, 5, 9]);
  const before = [1, 2, 3, 4, 5, 6];

  // #6 moved to the front and pushed every task after it one place on.
  expect(keepPins(before, moveTo(before, 6, 0), pins)).toEqual([6, 2, 1, 3, 5, 4]);
});

test("fillPlaces puts the named tasks in their new order into the places they hold, and placeMoves lists each task whose place changed", () => {
  // set_order names #74 and #60: they swap places, and #61 between them keeps its place.
  const before = [60, 61, 74, 75];
  const after = fillPlaces(before, [74, 60]);
  expect(after).toEqual([74, 61, 60, 75]);
  expect(placeMoves(before, after)).toEqual([
    { issue: 74, from: 3, to: 1 },
    { issue: 60, from: 1, to: 3 },
  ]);
  // A task named twice counts once, and a task outside the queue is left out.
  expect(fillPlaces(before, [75, 75, 99, 61])).toEqual([60, 75, 74, 61]);
});
