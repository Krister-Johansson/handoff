import { describe, expect, test } from "vitest";
import { evaluateCondition, type ConditionContext } from "./evaluate.ts";

const ctx: ConditionContext = {
  state: {
    feedback: { ci: { status: "failure" }, review: { decision: "approved", unresolvedThreads: 0 } },
    loops: { "pr->coder": { attempts: 2 } },
  },
  node: { key: "coder", status: "passed", attempt: 1, output: { status: "done", filesChanged: ["a.ts"] } },
  edge: { key: "pr->coder", maxAttempts: 3 },
};

describe("evaluateCondition", () => {
  test("always is true", () => expect(evaluateCondition({ always: true }, ctx)).toBe(true));
  test("eq compares a path to a literal", () => {
    expect(evaluateCondition({ eq: ["node.output.status", "done"] }, ctx)).toBe(true);
    expect(evaluateCondition({ eq: ["node.output.status", "failed"] }, ctx)).toBe(false);
  });
  test("neq is the negation of eq", () => expect(evaluateCondition({ neq: ["node.output.status", "failed"] }, ctx)).toBe(true));
  test("gt, gte, lt and lte compare numbers", () => {
    expect(evaluateCondition({ gt: ["node.attempt", 0] }, ctx)).toBe(true);
    expect(evaluateCondition({ gte: ["edge.maxAttempts", 3] }, ctx)).toBe(true);
    expect(evaluateCondition({ lt: ["edge.maxAttempts", 3] }, ctx)).toBe(false);
    expect(evaluateCondition({ lte: ["node.attempt", 1] }, ctx)).toBe(true);
  });
  test("numeric comparisons on a non-number are false", () =>
    expect(evaluateCondition({ gt: ["node.output.status", 0] }, ctx)).toBe(false));
  test("in checks membership", () => {
    expect(evaluateCondition({ in: ["node.status", ["passed", "repaired"]] }, ctx)).toBe(true);
    expect(evaluateCondition({ in: ["node.status", ["failed"]] }, ctx)).toBe(false);
  });
  test("exists is false for a missing path", () => {
    expect(evaluateCondition({ exists: "state.feedback.ci" }, ctx)).toBe(true);
    expect(evaluateCondition({ exists: "state.prNumber" }, ctx)).toBe(false);
  });
  test("eq on a missing path is false", () => expect(evaluateCondition({ eq: ["state.nope.deeper", null] }, ctx)).toBe(false));
  test("all, any and not combine conditions", () => {
    expect(
      evaluateCondition({ all: [{ eq: ["state.feedback.review.decision", "approved"] }, { eq: ["state.feedback.review.unresolvedThreads", 0] }] }, ctx),
    ).toBe(true);
    expect(evaluateCondition({ any: [{ eq: ["node.status", "failed"] }, { exists: "state.loops" }] }, ctx)).toBe(true);
    expect(evaluateCondition({ not: { always: true } }, ctx)).toBe(false);
  });
  test("eq compares objects and arrays structurally", () =>
    expect(evaluateCondition({ eq: ["node.output.filesChanged", ["a.ts"]] }, ctx)).toBe(true));
  test("path segments can contain arrows, such as loop edge keys", () =>
    expect(evaluateCondition({ gte: ["state.loops.pr->coder.attempts", 2] }, ctx)).toBe(true));
  test("evaluateCondition routes CI failure back to the Coder node", () =>
    expect(evaluateCondition({ eq: ["state.feedback.ci.status", "failure"] }, ctx)).toBe(true));
});
