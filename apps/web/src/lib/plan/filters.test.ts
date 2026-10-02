import { expect, test } from "vitest";
import { epic, planView, story, task, unplannedIssue } from "@/components/plan/testing/plan-fixtures";
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
  const view = planView([epic(12, "Project management", [story(41, "Shaping", 12, [task(55, "Tools", "Running", { assignees: ["krister"] }), task(57, "Migration", "Shaping")])])], {
    unparented: [task(70, "Speak", "Ready", { assignees: ["example-dev", "krister"] })],
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
