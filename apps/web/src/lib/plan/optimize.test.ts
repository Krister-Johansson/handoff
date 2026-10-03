import { expect, test } from "vitest";
import { optimize, type OptimizeInput, type OptimizeTask } from "./optimize";

/** A Ready task of size M with no blockers, unless `over` says otherwise. */
const task = (number: number, over: Partial<OptimizeTask> = {}): OptimizeTask => ({ number, status: "Ready", blockedBy: [], size: "M", ...over });

/** The queue in the order of `tasks`, no pins, the whole queue in scope and the default minutes per size. */
function input(tasks: OptimizeTask[], over: Partial<OptimizeInput> = {}): OptimizeInput {
  return { queue: tasks.map((t) => t.number), tasks, minutes: { S: 30, M: 60, L: 120 }, pins: new Set(), ...over };
}

test("blockers come before the tasks they block", () => {
  // #3 blocks #2; #50 is running, so it is not in the queue.
  const result = optimize(input([task(1, { blockedBy: [50] }), task(2, { blockedBy: [3] }), task(3), task(4, { size: "S" })]));

  expect(result.queue).toEqual([3, 1, 2, 4]);
});

test("the longest chain goes first, then the most unblocked work, then priority, then the larger size", () => {
  // #2 sits on a chain of 150 minutes (S then L); #1 unblocks more work, 180, on a chain of 90.
  const chain = [task(1, { size: "S" }), task(2, { size: "S" }), task(11, { blockedBy: [1] }), task(12, { blockedBy: [1] }), task(13, { blockedBy: [1] }), task(21, { size: "L", blockedBy: [2] })];
  expect(optimize(input(chain)).queue).toEqual([2, 21, 1, 11, 12, 13]);

  // Chains of 120 both; #3 unblocks 120 minutes of work and #4 60.
  const work = [task(4), task(3), task(41, { blockedBy: [4] }), task(31, { blockedBy: [3] }), task(32, { blockedBy: [3] })];
  expect(optimize(input(work)).queue).toEqual([3, 4, 41, 31, 32]);

  // Equal chains and work: P0 before P1, and a task without a priority after both.
  const priority = [task(7), task(5, { priority: "P1" }), task(6, { priority: "P0" })];
  expect(optimize(input(priority, { priorityOptions: ["P0", "P1"] })).queue).toEqual([6, 5, 7]);

  // The forecasts give every size the same length here, so only the size tells them apart.
  const size = [task(8, { size: "S" }), task(9, { size: undefined }), task(10, { size: "L" })];
  expect(optimize(input(size, { minutes: { S: 60, M: 60, L: 60 } })).queue).toEqual([10, 9, 8]);
});

test("pinned tasks and tasks outside the scope keep their places", () => {
  // #2 is pinned in the scope and #4 is pinned outside it. #6 ranks first but waits on #4.
  const tasks = [task(1, { size: "S" }), task(2, { size: "L" }), task(3, { size: "S" }), task(4), task(5), task(6, { size: "L", blockedBy: [4] })];
  const result = optimize(input(tasks, { pins: new Set([2, 4]), scope: new Set([1, 2, 3, 5, 6]) }));

  // #5 takes place 1, since #4 still sits later than it; #6 takes the first free place after #4.
  expect(result.queue).toEqual([5, 2, 1, 4, 6, 3]);
  expect(result.kept).toEqual([2]);
});

test("Shaping tasks are arranged among the places after the Ready tasks", () => {
  // The scheduler starts no Shaping task, so #4 ranks first but stays behind every Ready task.
  const tasks = [task(1, { size: "S" }), task(2, { size: "S" }), task(3, { status: "Shaping", size: "S" }), task(4, { status: "Shaping", size: "L" })];

  expect(optimize(input(tasks)).queue).toEqual([1, 2, 4, 3]);
});

test("the result lists each moved task with its old and new place", () => {
  const result = optimize(input([task(1), task(2), task(3), task(4, { size: "L" })], { pins: new Set([2]) }));

  expect(result.queue).toEqual([4, 2, 1, 3]);
  // Places count from 1, as Next does; #2 did not move.
  expect(result.moved).toEqual([
    { issue: 4, from: 4, to: 1 },
    { issue: 1, from: 1, to: 3 },
    { issue: 3, from: 3, to: 4 },
  ]);
});
