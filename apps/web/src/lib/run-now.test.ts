import { expect, test } from "vitest";
import { describeNow, type NowInput } from "./run-now";

const base: NowInput = { status: "running", executions: [], labels: { coder: "Code", pr: "Pull request", gate: "Ask a person", merge: "Merge" }, prNumber: null, questions: 0, reviews: 0 };
const exec = (nodeKey: string, status: string, extra: Partial<NowInput["executions"][number]> = {}) => ({ nodeKey, attempt: 1, status, ...extra });

test("a running node says who is working, with the attempt after the first", () => {
  expect(describeNow({ ...base, executions: [exec("coder", "running")] }).text).toBe("Code is working");
  expect(describeNow({ ...base, executions: [exec("coder", "running", { attempt: 2 })] }).text).toBe("Code is working, attempt 2");
});

test("waiting says what for: CI and reviews on the PR, or a person", () => {
  expect(describeNow({ ...base, status: "waiting", prNumber: 10, executions: [exec("pr", "waiting")] })).toEqual({ tone: "attention", text: "Waiting for CI and reviews on PR #10" });
  expect(describeNow({ ...base, status: "waiting", questions: 1, executions: [exec("gate", "waiting")] }).text).toBe("Waiting for your answer to Ask a person");
  expect(describeNow({ ...base, status: "waiting", questions: 1, reviews: 1, executions: [exec("gate", "waiting")] }).text).toBe("Ask a person waits for your review");
});

test("a queued node says it is queued", () => {
  expect(describeNow({ ...base, status: "queued", executions: [exec("coder", "pending")] }).text).toBe("Queued: Code");
});

test("a finished run says how it ended", () => {
  expect(describeNow({ ...base, status: "succeeded", prNumber: 10, executions: [exec("merge", "passed")] })).toEqual({ tone: "success", text: "Done. PR #10 merged." });
  expect(describeNow({ ...base, status: "succeeded", executions: [] }).text).toBe("Done.");
  expect(describeNow({ ...base, status: "failed", executions: [exec("coder", "failed", { error: "tests_green failed" })] })).toEqual({
    tone: "danger",
    text: "Stopped at Code: tests_green failed",
  });
  expect(describeNow({ ...base, status: "cancelled" }).text).toBe("Cancelled.");
});
