import { expect, test } from "vitest";
import { correlationKeys, prKey } from "./webhook-events.ts";

const repository = { id: 42, name: "sample", owner: { login: "octo" } };

test("prKey is stable per repository id and PR number", () => {
  expect(prKey(42, 7)).toBe("gh:pr:42:7");
});

test("correlationKeys derives PR keys from pull request events", () => {
  expect(correlationKeys("pull_request", { action: "synchronize", repository, pull_request: { number: 7 } })).toEqual(["gh:pr:42:7"]);
  expect(correlationKeys("pull_request_review", { repository, pull_request: { number: 7 } })).toEqual(["gh:pr:42:7"]);
  expect(correlationKeys("pull_request_review_comment", { repository, pull_request: { number: 7 } })).toEqual(["gh:pr:42:7"]);
});

test("correlationKeys derives a PR key from a comment on a PR and ignores plain issues", () => {
  expect(correlationKeys("issue_comment", { repository, issue: { number: 7, pull_request: { url: "x" } } })).toEqual(["gh:pr:42:7"]);
  expect(correlationKeys("issue_comment", { repository, issue: { number: 8 } })).toEqual([]);
});

test("correlationKeys derives gh:pr keys from a check_run payload's pull_requests", () => {
  expect(
    correlationKeys("check_run", { repository, check_run: { head_sha: "abc", pull_requests: [{ number: 7 }, { number: 9 }] } }),
  ).toEqual(["gh:pr:42:7", "gh:pr:42:9"]);
  expect(correlationKeys("check_suite", { repository, check_suite: { head_sha: "abc", pull_requests: [{ number: 7 }] } })).toEqual([
    "gh:pr:42:7",
  ]);
  expect(correlationKeys("workflow_run", { repository, workflow_run: { head_sha: "abc", pull_requests: [{ number: 7 }] } })).toEqual([
    "gh:pr:42:7",
  ]);
});

test("correlationKeys returns nothing for unrelated events or payloads without a repository", () => {
  expect(correlationKeys("push", { repository })).toEqual([]);
  expect(correlationKeys("pull_request", { pull_request: { number: 7 } })).toEqual([]);
});

test("headBranch reads the branch from check and workflow payloads", async () => {
  const { headBranch } = await import("./webhook-events.ts");
  expect(headBranch("check_suite", { check_suite: { head_branch: "b1" } })).toBe("b1");
  expect(headBranch("check_run", { check_run: { check_suite: { head_branch: "b2" } } })).toBe("b2");
  expect(headBranch("workflow_run", { workflow_run: { head_branch: "b3" } })).toBe("b3");
  expect(headBranch("pull_request", { pull_request: { head: { ref: "b4" } } })).toBeUndefined();
});
