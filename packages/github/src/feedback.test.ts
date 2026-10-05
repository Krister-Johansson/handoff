import { expect, test } from "vitest";
import { FeedbackSchema } from "@handoff/core";
import { toFeedback } from "./feedback.ts";
import type { PrSnapshot, ReviewThread, ReviewThreadComment } from "./types.ts";

const base: PrSnapshot = {
  number: 7,
  title: "t",
  body: "",
  draft: false,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  updatedAt: "now",
  url: "https://github.com/octo/sample/pull/7",
  headSha: "abc",
  headRef: "handoff/x",
  state: "open",
  merged: false,
  mergeable: "MERGEABLE",
  reviewDecision: null,
  checks: { state: "SUCCESS", contexts: [] },
  reviews: [],
  reviewThreads: [],
  comments: [],
};

/** A review thread with one comment by a person, open or resolved. */
const thread = (isResolved: boolean, comment: Omit<ReviewThreadComment, "authorBot" | "createdAt">): ReviewThread => ({
  id: `PRRT_${comment.url}`,
  isResolved,
  isOutdated: false,
  path: comment.path ?? "",
  line: comment.line ?? null,
  originalLine: comment.line ?? null,
  viewerCanReply: true,
  viewerCanResolve: !isResolved,
  resolvedBy: isResolved ? "octocat" : null,
  comments: [{ ...comment, authorBot: false, createdAt: "now" }],
  latest: [{ ...comment, authorBot: false, createdAt: "now" }],
});

/** A PR comment by a person. */
const prComment = (author: string, body: string, url: string) => ({ author, body, url, createdAt: "now", updatedAt: "now" });

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
        thread(false, { author: "ann", body: "rename this", path: "a.ts", line: 3, url: "u1" }),
        thread(true, { author: "bob", body: "fixed already", path: "b.ts", line: 1, url: "u2" }),
      ],
      comments: [prComment("cat", "please add tests", "u3")],
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

test("toFeedback leaves out handoff's own PR comments, so the Coder is not fed its Reviewer's notes twice", () => {
  const f = toFeedback(
    {
      ...base,
      comments: [
        prComment("octocat", "Please add a test.", "u1"),
        prComment("handoff", "<!-- handoff:reviewer-notes -->\nNit.", "u2"),
      ],
    },
    [],
  );
  expect(f.review.comments.map((c) => c.body)).toEqual(["Please add a test."]);
});
