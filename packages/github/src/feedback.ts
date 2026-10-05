import type { Feedback } from "@handoff/core";
import type { PrSnapshot } from "./types.ts";

/** Comments handoff writes on a PR carry a marker like this; they are notes or requests, not feedback. */
export const HANDOFF_COMMENT_PREFIX = "<!-- handoff:";
export const REVIEWER_NOTES_MARKER = `${HANDOFF_COMMENT_PREFIX}reviewer-notes -->`;
/** Ends the comment the PR node posts to ask a reviewer for a review of one head commit; the comment starts with the reviewer's command. */
export const reviewRequestMarker = (headSha: string) => `${HANDOFF_COMMENT_PREFIX}review-request ${headSha} -->`;

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

/** Normalises a PR snapshot plus fetched job logs into the run state's feedback shape. */
export function toFeedback(snapshot: PrSnapshot, jobLogs: { jobId: number; log: string }[]): Feedback {
  const rollup = snapshot.checks?.state;
  const status: Feedback["ci"]["status"] = rollup === "SUCCESS" ? "success" : rollup === "FAILURE" || rollup === "ERROR" ? "failure" : "pending";
  const failedJobs = (snapshot.checks?.contexts ?? [])
    .filter((c) => c.conclusion !== null && FAILED.has(c.conclusion))
    .map((c) => ({
      name: c.name,
      jobId: c.checkRunId ?? 0,
      url: c.url,
      logExcerpt: jobLogs.find((l) => l.jobId === c.checkRunId)?.log ?? "",
    }));
  const decision: Feedback["review"]["decision"] =
    snapshot.reviewDecision === "APPROVED" ? "approved" : snapshot.reviewDecision === "CHANGES_REQUESTED" ? "changes_requested" : "none";
  const threadComments = snapshot.reviewThreads.flatMap((thread) =>
    thread.comments.slice(0, 1).map((c) => ({
      author: c.author,
      body: c.body,
      ...(c.path !== undefined ? { path: c.path } : {}),
      ...(c.line !== undefined ? { line: c.line } : {}),
      url: c.url,
      resolved: thread.isResolved,
    })),
  );
  const issueComments = snapshot.comments.filter((c) => !c.body.includes(HANDOFF_COMMENT_PREFIX)).map((c) => ({ author: c.author, body: c.body, url: c.url, resolved: false }));
  return {
    ci: { status, failedJobs },
    review: {
      decision,
      comments: [...threadComments, ...issueComments],
      unresolvedThreads: snapshot.reviewThreads.filter((t) => !t.isResolved).length,
    },
    updatedAt: new Date().toISOString(),
  };
}
