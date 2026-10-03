import { expect, test } from "vitest";
import { graphPath, planPath, reviewPath, runPath, runsPath } from "./paths";

test("a run lives under its project, and a review under its run", () => {
  expect(runPath("p1", "r1")).toBe("/projects/p1/runs/r1");
  expect(reviewPath("p1", "r1", "q1")).toBe("/projects/p1/runs/r1/review/q1");
});

test("a project's runs take a status filter in the query", () => {
  expect(runsPath("p1")).toBe("/projects/p1/runs");
  expect(runsPath("p1", "waiting")).toBe("/projects/p1/runs?status=waiting");
});

test("the plan lives under its project, with the view, an epic and statuses in the query", () => {
  expect(planPath("p1")).toBe("/projects/p1/plan");
  // Without a view the Plan page opens the plan mode's view, so the tree is named like the others.
  expect(planPath("p1", { view: "tree" })).toBe("/projects/p1/plan?view=tree");
  expect(planPath("p1", { view: "board", epic: 12, status: ["Ready", "In review"] })).toBe("/projects/p1/plan?view=board&epic=12&status=Ready,In%20review");
  // The unplanned issues are a block of the tree.
  expect(planPath("p1", { epic: "unplanned", run: "needs-you" })).toBe("/projects/p1/plan?view=tree&epic=unplanned&run=needs-you");
  expect(planPath("p1", { run: "any" })).toBe("/projects/p1/plan");
});

test("a graph opens in its editor at its latest version, or at the version a run is pinned to", () => {
  expect(graphPath("p1", "master")).toBe("/projects/p1/graphs/master");
  expect(graphPath("p1", "plan review", 9)).toBe("/projects/p1/graphs/plan%20review?version=9");
});
