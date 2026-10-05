import type { Feedback } from "@handoff/core";
import { HANDOFF_COMMENT_PREFIX, type PrSnapshot } from "@handoff/github";

/** A login as GitHub shows it in GraphQL or REST: coderabbitai and coderabbitai[bot] are the same reviewer. */
export const sameLogin = (a: string, b: string) => a.toLowerCase().replace(/\[bot\]$/, "") === b.toLowerCase().replace(/\[bot\]$/, "");

export type ReviewSettings = { waitFor: string[]; timeoutMs: number; sendBack: boolean };

/** The PR node's review settings: reviewers to wait for, how long, and whether their comments go back to the coder. */
export function reviewSettings(config: Record<string, unknown>): ReviewSettings {
  const waitFor = Array.isArray(config.waitForReviewers) ? config.waitForReviewers.map(String).filter(Boolean) : [];
  const minutes = typeof config.reviewTimeoutMinutes === "number" && config.reviewTimeoutMinutes >= 0 ? config.reviewTimeoutMinutes : 30;
  // Sending comments back defaults on only when the node waits for reviewers, so older graphs keep routing as before.
  const sendBack = typeof config.sendReviewComments === "boolean" ? config.sendReviewComments : waitFor.length > 0;
  return { waitFor, timeoutMs: minutes * 60_000, sendBack };
}

/** A comment that asks a reviewer to review, posted when it has not started on a commit some minutes after the push. */
export type ReviewRequest = { reviewer: string; comment: string; afterMs: number };

/** The PR node's `reviewRequest` setting, or undefined when it has none. The comment defaults to `@<reviewer> review`, the delay to two minutes. */
export function reviewRequest(config: Record<string, unknown>): ReviewRequest | undefined {
  const raw = config.reviewRequest;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { reviewer, comment, afterMinutes } = raw as Record<string, unknown>;
  if (typeof reviewer !== "string" || !reviewer.trim()) return undefined;
  const text = typeof comment === "string" && comment.trim() ? comment.trim() : `@${reviewer.trim().replace(/\[bot\]$/i, "")} review`;
  const minutes = typeof afterMinutes === "number" && afterMinutes >= 0 ? afterMinutes : 2;
  return { reviewer: reviewer.trim(), comment: text, afterMs: minutes * 60_000 };
}

/** A login or a status name in lower case letters and digits only: coderabbitai[bot] and CodeRabbit become coderabbitai and coderabbit. */
const plain = (name: string) => name.toLowerCase().replace(/\[bot\]$/, "").replace(/[^a-z0-9]/g, "");

/**
 * Whether a reviewer has started on the PR's head commit: it reviewed that commit, or a check or status
 * named after it (CodeRabbit's is "CodeRabbit") is in progress there.
 */
export function reviewerStarted(snapshot: PrSnapshot, login: string): boolean {
  if (snapshot.reviews.some((r) => r.commitSha === snapshot.headSha && sameLogin(r.author, login))) return true;
  const who = plain(login);
  return (snapshot.checks?.contexts ?? []).some((c) => {
    const name = plain(c.name);
    return c.conclusion === null && name !== "" && (who.startsWith(name) || name.startsWith(who));
  });
}

export type Finding ={ id: string; author: string; body: string; path?: string; line?: number; url: string };

/**
 * Where the reviews of the PR's head commit stand: which listed reviewers have not reviewed it yet,
 * whether the wait has run out, and what reviewers said that has not been sent back yet (unresolved
 * inline threads, and review summaries that are not approvals).
 */
export function externalReview(snapshot: PrSnapshot, settings: ReviewSettings, handled: ReadonlySet<string>, waitingForMs: number) {
  const onHead = snapshot.reviews.filter((r) => r.commitSha === snapshot.headSha);
  const missing = settings.waitFor.filter((login) => !onHead.some((r) => sameLogin(r.author, login)));
  const timedOut = missing.length > 0 && waitingForMs >= settings.timeoutMs;
  const findings: Finding[] = [];
  for (const thread of snapshot.reviewThreads) {
    const first = thread.comments[0];
    if (thread.isResolved || !first?.id || handled.has(`thread:${first.id}`) || first.body.startsWith(HANDOFF_COMMENT_PREFIX)) continue;
    findings.push({ id: `thread:${first.id}`, author: first.author, body: first.body, ...(first.path ? { path: first.path } : {}), ...(first.line ? { line: first.line } : {}), url: first.url });
  }
  for (const review of onHead) {
    if (review.state === "APPROVED" || review.state === "DISMISSED" || !review.body.trim() || handled.has(`review:${review.id}`)) continue;
    findings.push({ id: `review:${review.id}`, author: review.author, body: review.body.trim(), url: snapshot.url });
  }
  return { missing, timedOut, findings };
}

/** Feedback that asks for changes with exactly the new findings, so the coder works on what is new. */
export function withFindings(feedback: Feedback, findings: Finding[]): Feedback {
  return {
    ...feedback,
    review: {
      ...feedback.review,
      decision: "changes_requested",
      comments: findings.map((f) => ({ author: f.author, body: f.body, url: f.url, resolved: false, ...(f.path ? { path: f.path } : {}), ...(f.line ? { line: f.line } : {}) })),
    },
  };
}
