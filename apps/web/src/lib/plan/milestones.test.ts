import type { Milestone, PlanItem } from "@handoff/github";
import { expect, test } from "vitest";
import { layoutFlow, type FlowInput } from "./flow";
import { itemMilestones, milestoneProgress, resolveMilestone } from "./milestones";
import { deriveSpans } from "./schedule";

/** A plan item as listItems returns it: an open task in Ready with nothing else set, unless `over` says otherwise. */
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
    position: number,
    ...over,
  };
}

/** A milestone of octo/sample, open and without a due date unless `over` says otherwise. */
function milestone(number: number, title: string, over: Partial<Milestone> = {}): Milestone {
  return { number, title, description: "", dueOn: undefined, state: "open", openIssues: 0, closedIssues: 0, url: `https://github.com/octo/sample/milestone/${number}`, ...over };
}

const beta = { number: 1, title: "Redesign beta" };
const release = { number: 2, title: "0.9" };

test("a task without a milestone of its own takes its story's, else its epic's, and says where it came from", () => {
  const items = [
    item(12, { kind: "epic", milestone: beta }),
    item(40, { kind: "story", parent: 12 }),
    item(41, { kind: "story", parent: 12, milestone: release }),
    item(57, { parent: 40 }),
    item(58, { parent: 41 }),
    item(59, { parent: 41, milestone: beta }),
    item(60, { parent: 12 }),
  ];
  const of = itemMilestones(items);
  expect(of.get(12)).toEqual(beta);
  // A story takes its epic's, and a task its story's before its epic's.
  expect(of.get(40)).toEqual({ ...beta, inherited: { kind: "epic", issue: 12 } });
  expect(of.get(41)).toEqual(release);
  expect(of.get(57)).toEqual({ ...beta, inherited: { kind: "epic", issue: 12 } });
  expect(of.get(58)).toEqual({ ...release, inherited: { kind: "story", issue: 41 } });
  expect(of.get(59)).toEqual(beta);
  expect(of.get(60)).toEqual({ ...beta, inherited: { kind: "epic", issue: 12 } });
});

test("an item with no milestone up its epic and story has none, and an epic inherits from nothing", () => {
  const items = [
    item(12, { kind: "epic" }),
    item(40, { kind: "story", parent: 12 }),
    item(57, { parent: 40 }),
    item(70, { kind: "epic", parent: 99, milestone: undefined }),
    // A parent outside the plan, and a loop of parents, end the walk.
    item(80, { parent: 999 }),
    item(81, { parent: 82 }),
    item(82, { parent: 81 }),
  ];
  const of = itemMilestones(items);
  for (const n of [12, 40, 57, 70, 80, 81, 82]) expect(of.has(n)).toBe(false);
});

test("milestone progress counts the tasks in each milestone, own or inherited, by status, and the tasks in none", () => {
  const items = [
    item(12, { kind: "epic", milestone: beta }),
    item(40, { kind: "story", parent: 12 }),
    item(57, { parent: 40, status: "Done" }),
    item(58, { parent: 40, state: "closed", status: "In review" }),
    item(59, { parent: 40, status: "Running" }),
    item(60, { parent: 40, milestone: release, status: "Shaping" }),
    item(61, { status: "Ready" }),
    item(62, { status: "Backlog" as never }),
  ];
  const { milestones, none } = milestoneProgress([milestone(1, "Redesign beta"), milestone(2, "0.9"), milestone(3, "Empty", { state: "closed" })], items, {});
  expect(milestones.map((m) => [m.number, m.progress.done, m.progress.total])).toEqual([
    [1, 2, 3],
    [2, 0, 1],
    [3, 0, 0],
  ]);
  // A closed task is done whatever its Status says; epics and stories are not counted.
  expect(milestones[0]!.progress.byStatus).toEqual({ Shaping: 0, Ready: 0, Running: 1, "In review": 0, Done: 2, Other: 0 });
  expect(none).toEqual({ done: 0, total: 2, byStatus: { Shaping: 0, Ready: 1, Running: 0, "In review": 0, Done: 0, Other: 1 } });
  expect(milestones[0]).toMatchObject({ title: "Redesign beta", state: "open", url: "https://github.com/octo/sample/milestone/1" });
  expect(milestones[0]!.progress.timeline).toBeUndefined();
  expect(milestones[0]!.progress.flow).toBeUndefined();
});

// Noon local time on Saturday 10 October 2026.
const NOW = new Date(2026, 9, 10, 12, 0, 0);

test("in Timeline mode a milestone ends on the latest Target of its tasks, late or early against its due date, and names its tasks without dates", () => {
  const items = [
    item(12, { kind: "epic", milestone: beta, start: "2026-09-01", target: "2026-12-01" }),
    item(57, { parent: 12, start: "2026-10-01", target: "2026-10-02" }),
    item(58, { parent: 12, start: "2026-10-03", target: "2026-10-04" }),
    item(59, { parent: 12, target: "2026-09-30", state: "closed" }),
    // Undated: named when open, left out when done.
    item(152, { parent: 12 }),
    item(153, { parent: 12, status: "Done" }),
    item(60, { milestone: release, start: "2026-10-05", target: "2026-10-13" }),
    item(61, { milestone: { number: 4, title: "Undated" } }),
  ];
  const timeline = deriveSpans(items, [], NOW);
  const { milestones } = milestoneProgress(
    [milestone(1, "Redesign beta", { dueOn: "2026-10-03" }), milestone(2, "0.9", { dueOn: "2026-10-16" }), milestone(3, "No due date"), milestone(4, "Undated", { dueOn: "2026-10-20" })],
    items,
    { timeline },
  );
  const judged = Object.fromEntries(milestones.map((m) => [m.title, m.progress.timeline]));
  // The epic's own span is not a task's Target.
  expect(judged["Redesign beta"]).toEqual({ ends: "2026-10-04", daysPastDue: 1, undated: [152] });
  expect(judged["0.9"]).toEqual({ ends: "2026-10-13", daysPastDue: -3, undated: [] });
  expect(judged["No due date"]).toEqual({ ends: undefined, daysPastDue: undefined, undated: [] });
  expect(judged.Undated).toEqual({ ends: undefined, daysPastDue: undefined, undated: [61] });
  expect(milestones[0]!.progress.flow).toBeUndefined();
});

test("a milestone that ends on its due date is zero days past it, and one with a due date but no tasks has no end", () => {
  const items = [item(57, { milestone: beta, start: "2026-10-01", target: "2026-10-03" })];
  const { milestones } = milestoneProgress([milestone(1, "Redesign beta", { dueOn: "2026-10-03" }), milestone(2, "0.9", { dueOn: "2026-10-16" })], items, { timeline: deriveSpans(items, [], NOW) });
  expect(milestones.map((m) => m.progress.timeline)).toEqual([
    { ends: "2026-10-03", daysPastDue: 0, undated: [] },
    { ends: undefined, daysPastDue: undefined, undated: [] },
  ]);
});

/** One lane, Project order and the human skip label. */
function flowInput(tasks: PlanItem[]): FlowInput {
  return { tasks, runs: [], lanes: 1, order: "project", skipLabel: "human", latest: new Map(), held: [], pins: new Set(), minutes: { S: 30, M: 60, L: 120 } };
}

test("in Flow mode a milestone ends at the place of its last task in the order, names the tasks the scheduler skips, and gives no day", () => {
  const items = [
    item(12, { kind: "epic", milestone: release }),
    item(41, { kind: "story", parent: 12 }),
    item(57, { parent: 41 }),
    item(72, {}),
    item(62, { parent: 41 }),
    item(63, { parent: 41, labels: ["human"] }),
    item(64, { parent: 41, status: "Shaping" }),
    item(70, { milestone: beta }),
    item(71, { milestone: { number: 3, title: "Done" }, state: "closed" }),
  ].map((i, position) => ({ ...i, position }));
  const flow = layoutFlow(flowInput(items));
  expect(flow.queue).toEqual([57, 72, 62, 70, 64]);
  const { milestones } = milestoneProgress([milestone(2, "0.9", { dueOn: "2026-10-20" }), milestone(1, "Redesign beta"), milestone(3, "Done")], items, { flow });
  const judged = Object.fromEntries(milestones.map((m) => [m.title, m.progress.flow]));
  // 0.9's last task in the order is the Shaping task #64 at place 5; #63 carries the skip label and is not in the order.
  expect(judged["0.9"]).toEqual({ last: { issue: 64, place: 5 }, skipped: [63] });
  expect(judged["Redesign beta"]).toEqual({ last: { issue: 70, place: 4 }, skipped: [] });
  expect(judged.Done).toEqual({ last: undefined, skipped: [] });
  expect(milestones[0]!.progress.timeline).toBeUndefined();
});

test("resolveMilestone finds an open milestone by number or title and refuses a closed or unknown one with a sentence", () => {
  const listed = [milestone(1, "Redesign beta", { dueOn: "2026-10-03" }), milestone(2, "0.9"), milestone(3, "0.8", { state: "closed" })];
  const repo = { owner: "octo", name: "sample" };
  expect(resolveMilestone(listed, 2, repo)).toEqual({ number: 2, title: "0.9" });
  expect(resolveMilestone(listed, "redesign BETA", repo)).toEqual({ number: 1, title: "Redesign beta" });
  // A title that reads like a number is still a title.
  expect(resolveMilestone(listed, "0.9", repo)).toEqual({ number: 2, title: "0.9" });
  expect(resolveMilestone(listed, " 0.9 ", repo)).toEqual({ number: 2, title: "0.9" });
  expect(() => resolveMilestone(listed, 3, repo)).toThrow("Milestone 0.8 (#3) of octo/sample is closed. Reopen it on GitHub, or pick an open milestone: Redesign beta (#1, due 2026-10-03), 0.9 (#2).");
  expect(() => resolveMilestone(listed, "0.8", repo)).toThrow(/^Milestone 0\.8 \(#3\) of octo\/sample is closed\./);
  expect(() => resolveMilestone(listed, 9, repo)).toThrow("octo/sample has no milestone #9. Its open milestones: Redesign beta (#1, due 2026-10-03), 0.9 (#2).");
  expect(() => resolveMilestone(listed, "1.0", repo)).toThrow('octo/sample has no milestone "1.0". Its open milestones: Redesign beta (#1, due 2026-10-03), 0.9 (#2).');
  expect(() => resolveMilestone([], "1.0", repo)).toThrow('octo/sample has no milestone "1.0". It has no open milestones; create one on GitHub first.');
});
