import { expect, test } from "vitest";
import { epic, planView, story, task, unplannedIssue } from "@/components/plan/testing/plan-fixtures";
import { matchParts, searchPlan } from "./search";

const view = planView(
  [
    epic(12, "Project management", [
      story(40, "Read the plan from GitHub", 12, [task(52, "Projects port", "Done", { state: "closed" }), task(53, "Plan read model", "Done", { state: "closed" })]),
      story(41, "Shaping with the assistant", 12, [task(57, "Add the migration", "Shaping"), task(58, "Plan page tree and board", "Ready")]),
    ]),
    epic(10, "Voice", [story(18, "Voice settings", 10, [task(72, "Picker with local voices first", "Ready")]), story(17, "Push to talk", 10, [task(70, "Speak replies", "Running")])]),
  ],
  { unparented: [task(90, "Loose end", "Shaping")], unplanned: [unplannedIssue(301, "Worker restarts"), unplannedIssue(305, "Readiness check")] },
);
const shape = (r: ReturnType<typeof searchPlan>) => ({
  epics: r.epics.map((e) => [e.number, e.stories.map((s) => [s.number, s.tasks.map((t) => t.number)])]),
  unparented: r.unparented.map((t) => t.number),
  unplanned: r.unplanned.map((i) => i.number),
  board: Object.values(r.board).flat().map((t) => t.number).toSorted(),
});

test("an empty search keeps everything and opens nothing", () => {
  const r = searchPlan(view, "");
  expect(r.active).toBe(false);
  expect(shape(r).epics).toHaveLength(2);
  expect(r.open.size).toBe(0);
});

test("#58 keeps the task with its story and epic open above it, and counts one match in every view", () => {
  const r = searchPlan(view, "#58");
  expect(shape(r)).toEqual({ epics: [[12, [[41, [58]]]]], unparented: [], unplanned: [], board: [58] });
  expect([...r.open].toSorted()).toEqual(["e12", "s41"]);
  expect(r.matches).toEqual({ tree: 1, board: 1, timeline: 1 });
  expect(r.hidden).toEqual({ 12: 3 });
});

test("# with digits matches numbers that start with them, bare digits too, and titles match case-insensitively", () => {
  expect(shape(searchPlan(view, "#5")).epics).toEqual([[12, [[40, [52, 53]], [41, [57, 58]]]]]);
  expect(shape(searchPlan(view, "30")).unplanned).toEqual([301, 305]);
  expect(shape(searchPlan(view, "MIGRATION")).board).toEqual([57]);
  expect(searchPlan(view, "loose").matches.tree).toBe(1);
  expect(searchPlan(view, "loose").open.has("unparented")).toBe(true);
  expect(searchPlan(view, "worker").open.has("unplanned")).toBe(true);
});

test("an epic that matches with nothing under it matching keeps all its rows but stays closed, and the board shows its cards", () => {
  const r = searchPlan(view, "voice");
  // Epic #10 matches, and so do story #18 and task #72 under it: only the path to them opens.
  expect(shape(r).epics).toEqual([[10, [[18, [72]]]]]);
  expect(r.open.has("e10")).toBe(true);
  expect(r.matches.tree).toBe(3);

  const epicOnly = searchPlan(view, "project management");
  expect(shape(epicOnly).epics).toEqual([[12, [[40, [52, 53]], [41, [57, 58]]]]]);
  expect(epicOnly.open.size).toBe(0);
  expect(epicOnly.hidden).toEqual({});
  expect(shape(epicOnly).board).toEqual([52, 53, 57, 58]);
  expect(epicOnly.matches).toEqual({ tree: 1, board: 4, timeline: 1 });
});

test("nothing matches: every view is empty and the count is zero", () => {
  const r = searchPlan(view, "deploy");
  expect(shape(r)).toEqual({ epics: [], unparented: [], unplanned: [], board: [] });
  expect(r.matches).toEqual({ tree: 0, board: 0, timeline: 0 });
});

test("matchParts splits a title around the text the search found, and a number around its prefix", () => {
  expect(matchParts("Add the migration", "MIG")).toEqual([
    { text: "Add the ", hit: false },
    { text: "mig", hit: true },
    { text: "ration", hit: false },
  ]);
  expect(matchParts("Add the migration", "")).toEqual([{ text: "Add the migration", hit: false }]);
  expect(matchParts("#58", "#5")).toEqual([
    { text: "#5", hit: true },
    { text: "8", hit: false },
  ]);
});
