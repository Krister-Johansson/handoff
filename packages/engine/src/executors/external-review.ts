import type { Feedback } from "@handoff/core";
import { HANDOFF_COMMENT_PREFIX, summaryCoversHead, type CheckContext, type CodeRabbitSummary, type PrSnapshot, type ReviewThread } from "@handoff/github";

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

/**
 * The PR node's `reviewThreads` setting. `reply` makes each finding sent back a review item that the
 * coder answers and handoff answers on GitHub; it is off by default, since it posts on GitHub, and it
 * needs review comments sent back. `resolveAfterReview` defaults to `reply`. `summary` names the bot
 * whose summary comment is read for notes and pre-merge checks. `maxPerRound` caps the items one round sends.
 * `returnOnAnswerOnly`, on by default, sends a round in which the coder only answered straight back to the PR node.
 * `botWaitMs` and `personWaitMs` are how long the PR node waits for a reviewer's next review after an
 * answer, by the reviewer's type: 30 minutes for a bot and 24 hours for a person unless set.
 */
export type ReviewThreadsSettings = {
  reply: boolean;
  resolveAfterReview: boolean;
  summary: string | undefined;
  maxPerRound: number;
  returnOnAnswerOnly: boolean;
  botWaitMs: number;
  personWaitMs: number;
};

const atLeastZero = (value: unknown, fallback: number) => (typeof value === "number" && value >= 0 ? value : fallback);

export function reviewThreadsSettings(config: Record<string, unknown>): ReviewThreadsSettings {
  const raw = typeof config.reviewThreads === "object" && config.reviewThreads !== null ? (config.reviewThreads as Record<string, unknown>) : {};
  const reply = raw.reply === true;
  const summary = typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim().replace(/\[bot\]$/i, "") : undefined;
  const maxPerRound = typeof raw.maxPerRound === "number" && raw.maxPerRound >= 1 ? Math.floor(raw.maxPerRound) : 20;
  return {
    reply,
    resolveAfterReview: reply && raw.resolveAfterReview !== false,
    summary,
    maxPerRound,
    returnOnAnswerOnly: raw.returnOnAnswerOnly !== false,
    botWaitMs: atLeastZero(raw.botWaitMinutes, 30) * 60_000,
    personWaitMs: atLeastZero(raw.personWaitHours, 24) * 3_600_000,
  };
}

/** A review bot's summary comment as the PR node read it, parsed. */
export type SummaryRead = { comment: { id?: number | undefined; url: string; body: string; updatedAt?: string | undefined }; summary: CodeRabbitSummary };

/** Merge risks under which a note that only says there is no merge-blocking issue asks nothing of the coder. */
const QUIET_RISKS = new Set(["minimal", "low"]);
const NO_BLOCKER = /\bno\b[^.]*\bmerge-blocking issues?\b/i;

/**
 * The findings of a summary comment: each walkthrough note and each failed or warning pre-merge check,
 * and a section the parser could not read as one finding with its text. A note that says there is no
 * merge-blocking issue, under a Minimal or Low merge risk, is not a finding.
 */
export function summaryFindings(read: SummaryRead, login: string): Finding[] {
  const { comment, summary } = read;
  const quiet = QUIET_RISKS.has((summary.mergeRisk ?? "").toLowerCase());
  return summary.findings.flatMap((f): Finding[] => {
    const base = { id: f.id, key: f.id, author: login, authorBot: true, url: comment.url, ...(comment.id !== undefined ? { githubId: String(comment.id) } : {}) };
    switch (f.kind) {
      case "summary_note":
        return quiet && NO_BLOCKER.test(f.text) ? [] : [{ ...base, kind: "summary_note", body: f.text }];
      case "pre_merge_check":
        return [{ ...base, kind: "pre_merge_check", body: [`${f.name} (${f.status || "failed"}): ${f.explanation}`, ...(f.resolution ? [`Resolution: ${f.resolution}`] : [])].join("\n\n") }];
      case "raw":
        return [{ ...base, kind: f.section === "pre_merge_checks" ? "pre_merge_check" : "summary_note", body: f.text }];
    }
  });
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

/** Whether a check or status is named after a reviewer: CodeRabbit's check "CodeRabbit" is named after coderabbitai[bot]. */
export function namedAfter(check: CheckContext, login: string): boolean {
  const who = plain(login);
  const name = plain(check.name);
  return name !== "" && (who.startsWith(name) || name.startsWith(who));
}

/**
 * Whether a check belongs to a reviewer the PR node waits for. Such a check shows the reviewer's
 * progress and is not CI: the node waits for that reviewer's review, up to the review time limit, instead.
 */
export const reviewerCheck = (settings: ReviewSettings) => (check: CheckContext) => settings.waitFor.some((login) => namedAfter(check, login));

/**
 * Whether a reviewer has started on the PR's head commit: it reviewed that commit, or a check or status
 * named after it (CodeRabbit's is "CodeRabbit") is in progress there.
 */
export function reviewerStarted(snapshot: PrSnapshot, login: string): boolean {
  if (snapshot.reviews.some((r) => r.commitSha === snapshot.headSha && sameLogin(r.author, login))) return true;
  return (snapshot.checks?.contexts ?? []).some((c) => c.conclusion === null && namedAfter(c, login));
}

/** What a finding is on GitHub: an inline thread, a review summary, or a note or a pre-merge check in a review bot's summary comment. */
export type FindingKind = "thread" | "review_body" | "summary_note" | "pre_merge_check";

/**
 * Something a reviewer said that has not been sent back yet. `id` is what `prHandledReviews` keeps
 * (`thread:<first comment id>`, `review:<id>`); `key` names it for review items (`thread:<thread node id>`,
 * `review:<id>`, `note:<hash>`, `check:<name>`). `githubId` is the thread's GraphQL node id, the
 * review's id, or the summary comment's id.
 */
export type Finding = {
  id: string;
  key: string;
  kind: FindingKind;
  author: string;
  authorBot: boolean;
  body: string;
  path?: string;
  line?: number;
  url: string;
  githubId?: string;
};

/** Whether handoff wrote a comment: every comment it posts carries its marker. */
export const byHandoff = (body: string) => body.includes(HANDOFF_COMMENT_PREFIX);

/** An inline thread as a finding, from its first comment; undefined for a thread handoff started or one without a first comment. */
export function threadFinding(thread: ReviewThread): Finding | undefined {
  const first = thread.comments[0];
  if (!first?.id || byHandoff(first.body)) return undefined;
  const line = first.line ?? thread.line ?? thread.originalLine ?? undefined;
  return {
    id: `thread:${first.id}`,
    key: `thread:${thread.id}`,
    kind: "thread",
    author: first.author,
    authorBot: first.authorBot,
    body: first.body,
    ...(first.path || thread.path ? { path: first.path || thread.path } : {}),
    ...(line ? { line } : {}),
    url: first.url,
    githubId: thread.id,
  };
}

/**
 * The reviewers behind a CHANGES_REQUESTED decision: those whose latest approving, requesting or dismissed
 * review requests changes. A comment-only review changes nothing, as on GitHub.
 */
export function changeRequesters(snapshot: PrSnapshot): string[] {
  const latest = new Map<string, string>();
  for (const review of snapshot.reviews) {
    if (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED" || review.state === "DISMISSED") latest.set(review.author, review.state);
  }
  return [...latest].filter(([, state]) => state === "CHANGES_REQUESTED").map(([author]) => author);
}

/**
 * Where the reviews of the PR's head commit stand: which listed reviewers have not reviewed it yet,
 * whether the wait has run out, and what reviewers said that has not been sent back yet (unresolved
 * inline threads, and review summaries that are not approvals).
 */
export function externalReview(
  snapshot: PrSnapshot,
  settings: ReviewSettings,
  handled: ReadonlySet<string>,
  waitingForMs: number,
  opts: { summary?: { login: string; read: SummaryRead | undefined } } = {},
) {
  const onHead = snapshot.reviews.filter((r) => r.commitSha === snapshot.headSha);
  const missing = settings.waitFor.filter((login) => !onHead.some((r) => sameLogin(r.author, login)));
  // A summary bot has finished with the head once its summary covers the head with no review in progress.
  const summary = opts.summary;
  const summaryDone = summary?.read !== undefined && summaryCoversHead(summary.read.summary, snapshot.headSha);
  if (summary && !summaryDone) missing.push(`${summary.login} summary`);
  const timedOut = missing.length > 0 && waitingForMs >= settings.timeoutMs;
  const findings: Finding[] = [];
  for (const thread of snapshot.reviewThreads) {
    const finding = threadFinding(thread);
    if (thread.isResolved || !finding || handled.has(finding.id)) continue;
    findings.push(finding);
  }
  for (const review of onHead) {
    if (review.state === "APPROVED" || review.state === "DISMISSED" || !review.body.trim() || byHandoff(review.body) || handled.has(`review:${review.id}`)) continue;
    findings.push({ id: `review:${review.id}`, key: `review:${review.id}`, kind: "review_body", author: review.author, authorBot: review.authorBot, body: review.body.trim(), url: snapshot.url, githubId: review.id });
  }
  // The summary of the head counts; at the time limit the latest summary does, whatever commit it covers.
  if (summary?.read && (summaryDone || timedOut)) findings.push(...summaryFindings(summary.read, summary.login).filter((f) => !handled.has(f.key)));
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
