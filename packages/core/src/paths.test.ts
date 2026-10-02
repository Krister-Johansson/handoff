import { expect, test } from "vitest";
import { reviewPath, runPath, tryPath } from "./paths.ts";

test("a run lives under its project, and a review or a Try it page under its run", () => {
  expect(runPath("p1", "r1")).toBe("/projects/p1/runs/r1");
  expect(reviewPath("p1", "r1", "q1")).toBe("/projects/p1/runs/r1/review/q1");
  expect(tryPath("p1", "r1", "q1")).toBe("/projects/p1/runs/r1/try/q1");
});
