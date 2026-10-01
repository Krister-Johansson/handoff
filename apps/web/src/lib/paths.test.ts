import { expect, test } from "vitest";
import { reviewPath, runPath } from "./paths";

test("a run lives under its project, and a review under its run", () => {
  expect(runPath("p1", "r1")).toBe("/projects/p1/runs/r1");
  expect(reviewPath("p1", "r1", "q1")).toBe("/projects/p1/runs/r1/review/q1");
});
