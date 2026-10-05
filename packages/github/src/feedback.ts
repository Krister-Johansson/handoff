import type { Feedback } from "@handoff/core";
import type { CheckContext, PrSnapshot } from "./types.ts";

/** Comments handoff writes on a PR carry a marker like this; they are notes or requests, not feedback. */
export const HANDOFF_COMMENT_PREFIX = "<!-- handoff:";
export const REVIEWER_NOTES_MARKER = `${HANDOFF_COMMENT_PREFIX}reviewer-notes -->`;
/** Ends the comment the PR node posts to ask a reviewer for a review of one head commit; the comment starts with the reviewer's command. */
export const reviewRequestMarker = (headSha: string) => `${HANDOFF_COMMENT_PREFIX}review-request ${headSha} -->`;

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

/**
 * The snapshot without the checks `leaveOut` picks, such as a review bot's own check, which shows the
 * bot's progress and is not CI. The rollup state is worked out again from the checks that are left: a
 * failed one makes it FAILURE, then one still running makes it PENDING, then a rollup that waits for a
 * required check that has not reported stays EXPECTED, and otherwise it is SUCCESS. With no check left
 * the head commit has no checks. A snapshot with no check to leave out comes back as it is.
 */
export function withoutChecks(snapshot: PrSnapshot, leaveOut: (check: CheckContext) => boolean): PrSnapshot {
  if (!snapshot.checks?.contexts.some(leaveOut)) return snapshot;
  const contexts = snapshot.checks.contexts.filter((c) => !leaveOut(c));
  if (contexts.length === 0) return { ...snapshot, checks: null };
  const state = contexts.some((c) => c.conclusion !== null && FAILED.has(c.conclusion))
    ? "FAILURE"
    : contexts.some((c) => c.conclusion === null)
      ? "PENDING"
      : snapshot.checks.state === "EXPECTED"
        ? "EXPECTED"
        : "SUCCESS";
  return { ...snapshot, checks: { state, contexts } };
}

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
