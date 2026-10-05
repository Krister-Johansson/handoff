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

test("a step waiting on a permission request says what it asks to do, though it is still running", () => {
  expect(describeNow({ ...base, executions: [exec("coder", "running")], permissions: [{ nodeKey: "coder", action: "asks to run a command" }] })).toEqual({
    tone: "attention",
    text: "Code asks to run a command",
  });
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

test("a run waiting in the merge queue says where it stands", () => {
  const waitingToMerge = { ...base, status: "waiting", executions: [exec("merge", "waiting")] };
  expect(describeNow({ ...waitingToMerge, queue: { position: 1, requested: false, mode: "manual" } }).text).toBe("Ready to merge");
  expect(describeNow({ ...waitingToMerge, queue: { position: 1, requested: true, mode: "manual" } }).text).toBe("Merging next");
  expect(describeNow({ ...waitingToMerge, queue: { position: 1, requested: false, mode: "auto" } }).text).toBe("Merging next");
  expect(describeNow({ ...waitingToMerge, queue: { position: 2, requested: false, mode: "manual" } }).text).toBe("Ready to merge, 2nd in line");
  expect(describeNow({ ...waitingToMerge, queue: { position: 3, requested: true, mode: "manual" } }).text).toBe("Merge requested, 3rd in line");
});

test("a merge waiting on unresolved review threads says how many a person must resolve", () => {
  const blocked = { ...base, status: "waiting", prNumber: 9, executions: [exec("merge", "waiting")] };
  expect(describeNow({ ...blocked, unresolvedThreads: 2 })).toEqual({ tone: "attention", text: "PR #9 has 2 unresolved review threads; the merge goes on once they are resolved" });
  expect(describeNow({ ...blocked, unresolvedThreads: 1 }).text).toBe("PR #9 has 1 unresolved review thread; the merge goes on once it is resolved");
});

test("a PR step waiting for a reviewer's next review after handoff's answers says whose, in blue: nobody has to act yet", () => {
  const waiting = { ...base, status: "waiting", prNumber: 88, executions: [exec("pr", "waiting")] };
  const bot = { login: "coderabbitai", bot: true };
  const person = { login: "Krister-Johansson", bot: false };
  expect(describeNow({ ...waiting, reReview: { reviewers: [bot], items: 7 } })).toEqual({ tone: "active", text: "Waiting for CodeRabbit's next review, 7 comments answered" });
  expect(describeNow({ ...waiting, reReview: { reviewers: [person], items: 1 } }).text).toBe("Waiting for Krister-Johansson's reply, 1 comment answered");
  expect(describeNow({ ...waiting, reReview: { reviewers: [bot, person], items: 8 } }).text).toBe("Waiting for CodeRabbit and Krister-Johansson, 8 comments answered");
  // A question the step asked about the comments comes first.
  expect(describeNow({ ...waiting, questions: 1, reReview: { reviewers: [bot], items: 7 } }).tone).toBe("attention");
});

test("a run waiting on GitHub dependencies says which issues it waits for", () => {
  const blocked = { ...base, status: "waiting", executions: [exec("start", "waiting")] };
  expect(describeNow({ ...blocked, blockedBy: [3] })).toEqual({ tone: "attention", text: "Waiting for #3 to close" });
  expect(describeNow({ ...blocked, blockedBy: [5, 6] }).text).toBe("Waiting for #5 and #6 to close");
  expect(describeNow({ ...blocked, blockedBy: [4, 5, 6] }).text).toBe("Waiting for #4, #5 and #6 to close");
});
