import { expect, test } from "vitest";
import { epic, milestone, person, planView, story, task, unplannedIssue, withMilestones } from "@/components/plan/testing/plan-fixtures";
import { planPath } from "@/lib/paths";
import { filterPlan, isFiltered, parsePlanFilters } from "./filters";

test("the Assignee filter reads ?assignee= as me, none or a login, and the search reads ?q=", () => {
  expect(parsePlanFilters({}).assignee).toBe("anyone");
  expect(parsePlanFilters({ assignee: "me" }).assignee).toBe("me");
  expect(parsePlanFilters({ assignee: "none" }).assignee).toBe("none");
  expect(parsePlanFilters({ assignee: "example-dev" }).assignee).toBe("example-dev");
  expect(parsePlanFilters({ assignee: "not a login!" }).assignee).toBe("anyone");
  expect(isFiltered(parsePlanFilters({ assignee: "none" }))).toBe(true);
  expect(parsePlanFilters({ q: "  #58 " }).q).toBe("#58");
  expect(parsePlanFilters({}).q).toBe("");
  // The search narrows the view but is not a filter: Clear filters keeps it.
  expect(isFiltered(parsePlanFilters({ q: "voice" }))).toBe(false);

  expect(planPath("p1", { view: "board", assignee: "me", q: "add migration" })).toBe("/projects/p1/plan?view=board&assignee=me&q=add%20migration");
  expect(planPath("p1", { assignee: "anyone", q: "" })).toBe("/projects/p1/plan");
});

test("the Assignee filter keeps the tasks assigned to me, to nobody, or to one person", () => {
  const view = planView([epic(12, "Project management", [story(41, "Shaping", 12, [task(55, "Tools", "Running", { assignees: [person("krister")] }), task(57, "Migration", "Shaping")])])], {
    unparented: [task(70, "Speak", "Ready", { assignees: [person("example-dev"), person("krister")] })],
    unplanned: [unplannedIssue(301, "Worker restarts")],
  });
  const tasks = (assignee: string, me?: string) => {
    const narrowed = filterPlan(view, parsePlanFilters({ assignee }), [], me);
    return { tree: [...narrowed.epics.flatMap((e) => e.stories.flatMap((s) => s.tasks)), ...narrowed.unparented].map((t) => t.number), board: Object.values(narrowed.board).flat().map((t) => t.number).toSorted(), unplanned: narrowed.unplanned.length };
  };
  expect(tasks("me", "krister")).toEqual({ tree: [55, 70], board: [55, 70], unplanned: 0 });
  expect(tasks("none")).toEqual({ tree: [57], board: [57], unplanned: 0 });
  expect(tasks("example-dev")).toEqual({ tree: [70], board: [70], unplanned: 0 });
  // Without a token user there is no me, so the filter keeps nothing rather than everything.
  expect(tasks("me")).toEqual({ tree: [], board: [], unplanned: 0 });
});

test("the Milestone filter reads ?milestone= as a number or none and lives in the plan's URL", () => {
  expect(parsePlanFilters({}).milestone).toBeUndefined();
  expect(parsePlanFilters({ milestone: "3" }).milestone).toBe(3);
  expect(parsePlanFilters({ milestone: "none" }).milestone).toBe("none");
  expect(parsePlanFilters({ milestone: "0.9" }).milestone).toBeUndefined();
  expect(isFiltered(parsePlanFilters({ milestone: "3" }))).toBe(true);
  expect(planPath("p1", { view: "flow", milestone: 3, q: "chip" })).toBe("/projects/p1/plan?view=flow&milestone=3&q=chip");
  expect(planPath("p1", { milestone: "none" })).toBe("/projects/p1/plan?milestone=none");
});

test("the Milestone filter keeps the tasks in a milestone, own or inherited, or the tasks in none", () => {
  const beta = { number: 1, title: "Redesign beta" };
  const release = { number: 2, title: "1.0" };
  const view = withMilestones(
    planView(
      [
        epic(12, "Redesign", [story(41, "Foundations", 12, [task(55, "Tokens", "Running"), task(56, "Type", "Ready", { milestone: release })]), story(43, "Shell", 12, [task(60, "Sidebar", "Ready")], { milestone: release })], [], { milestone: beta }),
        epic(10, "Voice", [story(18, "Settings", 10, [task(70, "Speak", "Ready"), task(72, "Picker", "Ready", { milestone: beta })])]),
      ],
      { unparented: [task(80, "Docs", "Shaping")], unplanned: [unplannedIssue(301, "Worker restarts")] },
    ),
    [milestone(1, "Redesign beta"), milestone(2, "1.0")],
  );
  const shown = (m: string) => {
    const narrowed = filterPlan(view, parsePlanFilters({ milestone: m }), []);
    return {
      tree: [...narrowed.epics.flatMap((e) => [...e.stories.flatMap((s) => s.tasks), ...e.tasks]), ...narrowed.unparented].map((t) => t.number),
      stories: narrowed.epics.flatMap((e) => e.stories.map((s) => s.number)),
      board: Object.values(narrowed.board).flat().map((t) => t.number).toSorted(),
      unplanned: narrowed.unplanned.length,
      hidden: narrowed.hidden,
    };
  };
  // #55 inherits beta from epic #12; #56 and story #43's #60 are in 1.0; #72 sets beta on itself under an epic in none.
  expect(shown("1")).toEqual({ tree: [55, 72], stories: [41, 18], board: [55, 72], unplanned: 0, hidden: { 12: 2, 10: 1 } });
  expect(shown("2")).toEqual({ tree: [56, 60], stories: [41, 43], board: [56, 60], unplanned: 0, hidden: { 12: 1 } });
  expect(shown("none")).toEqual({ tree: [70, 80], stories: [18], board: [70, 80], unplanned: 0, hidden: { 10: 1 } });
});
