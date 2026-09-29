import { expect, test } from "vitest";
import { describeCondition } from "./condition-text";

test("describes comparisons by the last path segments", () => {
  expect(describeCondition({ eq: ["node.output.status", "done"] })).toBe("status = done");
  expect(describeCondition({ neq: ["node.output.feedback.review.decision", "changes_requested"] })).toBe("review.decision ≠ changes_requested");
  expect(describeCondition({ gte: ["state.loops.pr->coder.attempts", 3] })).toBe("pr->coder.attempts ≥ 3");
  expect(describeCondition({ exists: "state.prNumber" })).toBe("prNumber exists");
  expect(describeCondition({ in: ["node.status", ["passed", "repaired"]] })).toBe("status in passed, repaired");
});

test("describes combinations", () => {
  expect(describeCondition({ all: [{ eq: ["node.output.feedback.ci.status", "success"] }, { always: true }] })).toBe("ci.status = success and always");
  expect(describeCondition({ any: [{ eq: ["node.output.passed", false] }, { not: { exists: "state.plan" } }] })).toBe("passed = false or not plan exists");
});

test("no condition means always", () => {
  expect(describeCondition(undefined)).toBe("");
});
