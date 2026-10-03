import { candidates, type IssueRun } from "@handoff/engine/candidates";
import type { PlanItem } from "@handoff/github";
import { expect, test } from "vitest";
import { layoutFlow, type Flow, type FlowInput, type FlowRun } from "./flow";

/** A plan item as listItems returns it: an open task in Ready of size M with no blockers, unless `over` says otherwise. */
function task(number: number, over: Partial<PlanItem> = {}): PlanItem {
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
    size: "M",
    ...over,
  };
}

/** An active run on an issue, created `minute` minutes into the day. */
const run = (issue: number, minute: number, done: number, total: number, over: Partial<FlowRun> = {}): FlowRun => ({
  issue,
  runId: `${String(issue).padStart(8, "0")}-0000-0000-0000-000000000000`,
  createdAt: new Date(Date.UTC(2026, 9, 3, 8, minute)),
  progress: { done, total },
  ...over,
});

/** One lane, Project order, the human skip label and the default minutes per size. */
function input(over: Partial<FlowInput> = {}): FlowInput {
  return {
    tasks: [],
    runs: [],
    lanes: 1,
    order: "project",
    skipLabel: "human",
    latest: new Map(),
    held: [],
    pins: new Set(),
    minutes: { S: 30, M: 60, L: 120 },
    ...over,
  };
}

/** Each card as issue, lane, start and end, the shape most tests compare. */
const placed = (flow: Flow) => flow.cards.map(({ issue, lane, start, end }) => ({ issue, lane, start, end }));

/** The tags on one task's row. */
const tagsOf = (flow: Flow, issue: number) => flow.rows.find((r) => r.issue === issue)?.tags;

test("active runs take lanes, oldest first, and straddle Now by their done share", () => {
  const flow = layoutFlow(
    input({
      lanes: 2,
      tasks: [task(10, { status: "Running" }), task(11, { status: "Running", size: "L" })],
      // #11's run is older, so it takes slot 1 though #10 comes first in the list.
      runs: [run(10, 30, 1, 4), run(11, 5, 3, 4, { waitsOn: "Waits on you: review" })],
    }),
  );

  expect(placed(flow)).toEqual([
    // 120 minutes, three of four steps done: 90 left of Now and 30 to go.
    { issue: 11, lane: 1, start: -90, end: 30 },
    // 60 minutes, one of four steps done.
    { issue: 10, lane: 2, start: -15, end: 45 },
  ]);
  expect(flow.cards.map((c) => ({ kind: c.kind, progress: c.progress, waitsOn: c.waitsOn }))).toEqual([
    { kind: "running", progress: { done: 3, total: 4 }, waitsOn: "Waits on you: review" },
    { kind: "running", progress: { done: 1, total: 4 }, waitsOn: undefined },
  ]);
  expect(flow.lanes.map((lane) => lane.map((c) => c.issue))).toEqual([[11], [10]]);
  expect(flow.queue).toEqual([]);
  // A run waiting on a person keeps its lane, and its row says what it waits for.
  expect(flow.rows).toEqual([
    { issue: 10, tags: [] },
    { issue: 11, tags: ["Waits on you: review"] },
  ]);
});

test("the next task in order takes the lane that frees first", () => {
  const flow = layoutFlow(
    input({
      lanes: 2,
      tasks: [
        task(10, { status: "Running" }),
        task(11, { status: "Running", size: "L" }),
        task(20, { position: 2 }),
        task(21, { position: 1, size: "S" }),
        task(22, { position: 3 }),
      ],
      runs: [run(11, 5, 3, 4), run(10, 30, 1, 4)],
      pins: new Set([20]),
    }),
  );

  expect(flow.queue).toEqual([21, 20, 22]);
  expect(tagsOf(flow, 20)).toEqual(["Next 2", "Pinned"]);
  expect(flow.cards.filter((c) => c.pinned).map((c) => c.issue)).toEqual([20]);
  expect(placed(flow).slice(2)).toEqual([
    // Slot 1 frees at 30, slot 2 at 45.
    { issue: 21, lane: 1, start: 30, end: 60 },
    { issue: 20, lane: 2, start: 45, end: 105 },
    { issue: 22, lane: 1, start: 60, end: 120 },
  ]);
  expect(flow.cards.slice(2).map((c) => [c.kind, c.next])).toEqual([
    ["next", 1],
    ["next", 2],
    ["next", 3],
  ]);
  expect(flow.end).toBe(120);
});

test("a blocked task is passed over for the next one, as the scheduler does, and starts once its blocker's card ends", () => {
  const flow = layoutFlow(
    input({
      lanes: 2,
      tasks: [task(1, { size: "S" }), task(2, { blockedBy: [1] }), task(3), task(4)],
    }),
  );

  // #2 keeps its place in the order: Next 2.
  expect(flow.queue).toEqual([1, 2, 3, 4]);
  expect(placed(flow)).toEqual([
    { issue: 1, lane: 1, start: 0, end: 30 },
    // #2 cannot start at 0, so slot 2 takes #3.
    { issue: 3, lane: 2, start: 0, end: 60 },
    // #1 ends at 30 and slot 1 frees with it: #2 starts.
    { issue: 2, lane: 1, start: 30, end: 90 },
    { issue: 4, lane: 2, start: 60, end: 120 },
  ]);
  expect(flow.cards.map((c) => [c.issue, c.next, c.after])).toEqual([
    [1, 1, undefined],
    [3, 3, undefined],
    [2, 2, undefined],
    [4, 4, undefined],
  ]);
});

test("a lane with no startable task waits for the next card to end and the task says After #55", () => {
  const flow = layoutFlow(
    input({
      lanes: 2,
      tasks: [task(55, { size: "L" }), task(56, { blockedBy: [55] }), task(57, { size: "S" })],
    }),
  );

  expect(placed(flow)).toEqual([
    { issue: 55, lane: 1, start: 0, end: 120 },
    { issue: 57, lane: 2, start: 0, end: 30 },
    // Slot 2 is free from 30 but #56 may not start until #55 ends.
    { issue: 56, lane: 2, start: 120, end: 180 },
  ]);
  expect(flow.cards.find((c) => c.issue === 56)?.after).toBe(55);
  expect(tagsOf(flow, 56)).toEqual(["Next 2", "After #55"]);
  expect(tagsOf(flow, 57)).toEqual(["Next 3"]);
  expect(flow.arrows).toEqual([{ from: 55, to: 56 }]);
});

test("skipped tasks keep their row and are not in the order", () => {
  const cancelled = "cccccccc-0000-0000-0000-000000000000";
  const released = "dddddddd-0000-0000-0000-000000000000";
  const flow = layoutFlow(
    input({
      tasks: [task(1, { labels: ["task", "human"] }), task(2), task(3), task(4)],
      latest: new Map([
        [2, { id: cancelled, status: "cancelled" }],
        [3, { id: released, status: "cancelled" }],
      ]),
      released: new Set([released]),
    }),
  );

  expect(flow.queue).toEqual([3, 4]);
  expect(flow.cards.map((c) => c.issue)).toEqual([3, 4]);
  expect(tagsOf(flow, 1)).toEqual(["Skipped: label human", "Not in the order"]);
  expect(tagsOf(flow, 2)).toEqual(["Skipped: latest run cancelled", "Not in the order"]);
  expect(tagsOf(flow, 3)).toEqual(["Next 1"]);
});

test("Shaping tasks follow every Ready task", () => {
  const flow = layoutFlow(
    input({
      lanes: 2,
      tasks: [
        task(3, { position: 0, status: "Shaping", size: "S" }),
        task(1, { position: 1, size: "L" }),
        task(2, { position: 2, blockedBy: [1] }),
        task(4, { position: 3, state: "closed", status: "Done" }),
        task(5, { position: 4, status: "Done" }),
        task(6, { position: 10, status: "Shaping" }),
      ],
    }),
  );

  // #3 comes first in Project order, but no Shaping task starts before every Ready task has.
  expect(flow.queue).toEqual([1, 2, 3, 6]);
  expect(placed(flow)).toEqual([
    { issue: 1, lane: 1, start: 0, end: 120 },
    { issue: 2, lane: 2, start: 120, end: 180 },
    { issue: 3, lane: 1, start: 120, end: 150 },
    { issue: 6, lane: 1, start: 150, end: 210 },
  ]);
  expect(flow.cards.map((c) => [c.issue, c.kind, c.next])).toEqual([
    [1, "next", 1],
    [2, "next", 2],
    [3, "shaping", undefined],
    [6, "shaping", undefined],
  ]);
  expect(tagsOf(flow, 3)).toEqual(["Shaping"]);
  expect(tagsOf(flow, 4)).toEqual(["Done"]);
  expect(tagsOf(flow, 5)).toEqual(["Done"]);
});

test("a task blocked by an issue outside the order keeps its place, gets no card and names the issue", () => {
  const flow = layoutFlow(
    input({
      tasks: [
        // #40 is still being shaped, #41 is not in the plan, and #3 waits on #1.
        task(1, { blockedBy: [40] }),
        task(2, { blockedBy: [41] }),
        task(3, { blockedBy: [1] }),
        task(4),
        task(40, { status: "Shaping", size: "S" }),
      ],
    }),
  );

  expect(flow.queue).toEqual([1, 2, 3, 4, 40]);
  expect(placed(flow)).toEqual([
    { issue: 4, lane: 1, start: 0, end: 60 },
    { issue: 40, lane: 1, start: 60, end: 90 },
  ]);
  expect(flow.rows).toEqual([
    { issue: 1, tags: ["Next 1", "Waits for #40, not in the order"] },
    { issue: 2, tags: ["Next 2", "Waits for #41, not in the order"] },
    { issue: 3, tags: ["Next 3", "Waits for #40, not in the order"] },
    { issue: 4, tags: ["Next 4"] },
    { issue: 40, tags: ["Shaping"] },
  ]);
});

test("a task placed before its blocker says Waits for the blocker and the flow lists the break", () => {
  const flow = layoutFlow(input({ tasks: [task(2, { position: 1, blockedBy: [1] }), task(1, { position: 2 }), task(3, { position: 3 })] }));

  expect(flow.queue).toEqual([2, 1, 3]);
  expect(flow.breaks).toEqual([{ issue: 2, waitsFor: [1] }]);
  expect(flow.rows).toEqual([
    { issue: 2, tags: ["Next 1", "Waits for #1"] },
    { issue: 1, tags: ["Next 2"] },
    { issue: 3, tags: ["Next 3"] },
  ]);
  // The flow still starts #2 after #1 ends.
  expect(placed(flow).map((c) => c.issue)).toEqual([1, 2, 3]);
});

test("a task without a size counts as M", () => {
  const flow = layoutFlow(
    input({
      minutes: { S: 20, M: 50, L: 90 },
      tasks: [task(1, { size: undefined }), task(2, { size: "S" })],
    }),
  );

  expect(flow.cards.map(({ issue, start, end, size, sized }) => ({ issue, start, end, size, sized }))).toEqual([
    { issue: 1, start: 0, end: 50, size: "M", sized: false },
    { issue: 2, start: 50, end: 70, size: "S", sized: true },
  ]);
});

test("more active runs than lanes keep their own lanes until they end", () => {
  const flow = layoutFlow(
    input({
      lanes: 2,
      tasks: [task(10, { status: "Running" }), task(11, { status: "Running", size: "L" }), task(12, { status: "Running" }), task(1, { size: "S" }), task(2, { size: "S" })],
      // A person started #12 by hand: three runs on a scheduler that holds two.
      runs: [run(10, 0, 1, 2), run(11, 10, 1, 4), run(12, 20, 0, 4)],
    }),
  );

  expect(placed(flow)).toEqual([
    { issue: 10, lane: 1, start: -30, end: 30 },
    { issue: 11, lane: 2, start: -30, end: 90 },
    { issue: 12, lane: 3, start: 0, end: 60 },
    // Slot 1 frees at 30, but two runs still hold the project until #12 ends at 60.
    { issue: 1, lane: 1, start: 60, end: 90 },
    // Slot 3 closed with #12's run: #2 waits for slot 1.
    { issue: 2, lane: 1, start: 90, end: 120 },
  ]);
  expect(flow.lanes.map((lane) => lane.map((c) => c.issue))).toEqual([[10, 1, 2], [11], [12]]);
});

test("a hold puts Waits for the hold on the first task", () => {
  const tasks = [task(1), task(2)];
  const held = layoutFlow(input({ tasks, held: ["#56 failed at Review"] }));
  const free = layoutFlow(input({ tasks }));

  expect(held.held).toEqual(["#56 failed at Review"]);
  expect(tagsOf(held, 1)).toEqual(["Next 1", "Waits for the hold"]);
  expect(tagsOf(held, 2)).toEqual(["Next 2"]);
  expect(tagsOf(free, 1)).toEqual(["Next 1"]);
  // Cards sit as if the hold cleared now.
  expect(placed(held)).toEqual(placed(free));
});

test("the flow's order of Ready tasks without blockers equals candidates()", () => {
  const queuedRun = "44444444-0000-0000-0000-000000000000";
  const cancelled = "66666666-0000-0000-0000-000000000000";
  const tasks = [
    task(1, { position: 1, priority: "P1" }),
    task(2, { position: 2, labels: ["task", "human"] }),
    task(3, { position: 3, priority: "P0", blockedBy: [1] }),
    // A run was just queued for #4; its Status still says Ready.
    task(4, { position: 4, priority: "P0" }),
    task(5, { position: 5 }),
    task(6, { position: 6, priority: "P0" }),
    task(7, { position: 7, priority: "P1", kind: "story" }),
    task(8, { position: 8, priority: "P0", status: "Shaping" }),
    task(9, { position: 9, priority: "P1" }),
  ];
  const latest = new Map<number, IssueRun>([
    [4, { id: queuedRun, status: "queued" }],
    [6, { id: cancelled, status: "cancelled" }],
  ]);
  const runs = [run(4, 0, 0, 5, { runId: queuedRun })];

  for (const order of ["project", "priority"] as const) {
    const opts = { order, priorityOptions: ["P0", "P1"], skipLabel: "human" };
    const flow = layoutFlow(input({ ...opts, tasks, latest, runs, lanes: 2 }));
    const ready = new Set(tasks.filter((t) => t.status === "Ready" && t.blockedBy.length === 0).map((t) => t.number));
    expect(flow.queue.filter((n) => ready.has(n))).toEqual(candidates(tasks, latest, opts).candidates.map((c) => c.number));
  }
  expect(layoutFlow(input({ tasks, latest, runs, priorityOptions: ["P0", "P1"], order: "priority" })).queue).toEqual([3, 1, 9, 5, 8]);
});
