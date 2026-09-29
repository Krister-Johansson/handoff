import type { Feedback } from "@handoff/core";
import type { PrSnapshot } from "./types.ts";

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
  const issueComments = snapshot.comments.map((c) => ({ author: c.author, body: c.body, url: c.url, resolved: false }));
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
