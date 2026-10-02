import { expect, test } from "vitest";
import { planPath, reviewPath, runPath } from "./paths";

test("a run lives under its project, and a review under its run", () => {
  expect(runPath("p1", "r1")).toBe("/projects/p1/runs/r1");
  expect(reviewPath("p1", "r1", "q1")).toBe("/projects/p1/runs/r1/review/q1");
});

test("the plan lives under its project, with the view, an epic and statuses in the query", () => {
  expect(planPath("p1")).toBe("/projects/p1/plan");
  expect(planPath("p1", { view: "tree" })).toBe("/projects/p1/plan");
  expect(planPath("p1", { view: "board", epic: 12, status: ["Ready", "In review"] })).toBe("/projects/p1/plan?view=board&epic=12&status=Ready,In%20review");
  expect(planPath("p1", { epic: "unplanned", run: "needs-you" })).toBe("/projects/p1/plan?epic=unplanned&run=needs-you");
  expect(planPath("p1", { run: "any" })).toBe("/projects/p1/plan");
});
