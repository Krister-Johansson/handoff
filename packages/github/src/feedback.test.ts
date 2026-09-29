import { expect, test } from "vitest";
import { FeedbackSchema } from "@handoff/core";
import { toFeedback } from "./feedback.ts";
import type { PrSnapshot } from "./types.ts";

const base: PrSnapshot = {
  number: 7,
  url: "https://github.com/octo/sample/pull/7",
  headSha: "abc",
  headRef: "handoff/x",
  state: "open",
  merged: false,
  mergeable: "MERGEABLE",
  reviewDecision: null,
  checks: { state: "SUCCESS", contexts: [] },
  reviewThreads: [],
  comments: [],
};

test("toFeedback maps a green rollup with no reviews to ci success and decision none", () => {
  const f = toFeedback(base, []);
  expect(FeedbackSchema.parse(f)).toBeTruthy();
  expect(f.ci.status).toBe("success");
  expect(f.review.decision).toBe("none");
});

test("toFeedback maps a failed rollup to ci failure with failed jobs and their log excerpts", () => {
  const f = toFeedback(
    {
      ...base,
      checks: {
        state: "FAILURE",
        contexts: [
          { name: "test", conclusion: "FAILURE", status: "COMPLETED", url: "https://github.com/x/runs/5", checkRunId: 5 },
          { name: "lint", conclusion: "SUCCESS", status: "COMPLETED", url: "u", checkRunId: 6 },
        ],
      },
    },
    [{ jobId: 5, log: "line1\nAssertionError: expected 1 to be 2" }],
  );
  expect(f.ci).toEqual({
    status: "failure",
    failedJobs: [{ name: "test", jobId: 5, url: "https://github.com/x/runs/5", logExcerpt: "line1\nAssertionError: expected 1 to be 2" }],
  });
});

test("toFeedback treats pending, expected and missing rollups as pending", () => {
  expect(toFeedback({ ...base, checks: { state: "PENDING", contexts: [] } }, []).ci.status).toBe("pending");
  expect(toFeedback({ ...base, checks: { state: "EXPECTED", contexts: [] } }, []).ci.status).toBe("pending");
  expect(toFeedback({ ...base, checks: null }, []).ci.status).toBe("pending");
});

test("toFeedback maps a changes-requested review to feedback with unresolved thread comments", () => {
  const f = toFeedback(
    {
      ...base,
      reviewDecision: "CHANGES_REQUESTED",
      reviewThreads: [
        { isResolved: false, comments: [{ author: "ann", body: "rename this", path: "a.ts", line: 3, url: "u1" }] },
        { isResolved: true, comments: [{ author: "bob", body: "fixed already", path: "b.ts", line: 1, url: "u2" }] },
      ],
      comments: [{ author: "cat", body: "please add tests", url: "u3" }],
    },
    [],
  );
  expect(f.review.decision).toBe("changes_requested");
  expect(f.review.unresolvedThreads).toBe(1);
  expect(f.review.comments).toEqual([
    { author: "ann", body: "rename this", path: "a.ts", line: 3, url: "u1", resolved: false },
    { author: "bob", body: "fixed already", path: "b.ts", line: 1, url: "u2", resolved: true },
    { author: "cat", body: "please add tests", url: "u3", resolved: false },
  ]);
});

test("toFeedback maps an approval", () => {
  expect(toFeedback({ ...base, reviewDecision: "APPROVED" }, []).review.decision).toBe("approved");
});
