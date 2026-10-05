import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Feedback, RunState } from "@handoff/core";
import { and, asc, eq, inArray, reviewItems, sql, type Db, type ReviewItemRow } from "@handoff/db";
import { HANDOFF_COMMENT_PREFIX, summaryCoversHead, type GitHubPort, type PrSnapshot, type RepoRef, type ReviewThread } from "@handoff/github";
import { recordedAnswers } from "../review-answers.ts";
import type { ExecutorContext } from "../types.ts";
import { byHandoff, sameLogin, summaryFindings, threadFinding, type Finding, type ReviewThreadsSettings, type SummaryRead } from "./external-review.ts";

/**
 * Review items: the findings a PR node sends to the coder with a handle (`R1`), the coder's answers,
 * handoff's answers on GitHub, and what the reviewer's next review makes of them.
 * The PR node is the only writer of `review_items`.
 *
 * Plan: docs/plans/review-threads.md, Decisions 1, 3, 5 and 7. A person's choice (Decision 8) builds on
 * the items that `awaitingReview` reports as overdue and on those the reviewer answered back.
 */

const execFileAsync = promisify(execFile);

/** The handle the coder and the dashboard know an item by. */
export const handleOf = (item: Pick<ReviewItemRow, "handle">) => `R${item.handle}`;

/** Ends handoff's reply in an item's thread: one reply per item and head commit. */
export const itemReplyMarker = (handle: number, headSha: string) => `${HANDOFF_COMMENT_PREFIX}item-reply R${handle} ${headSha} -->`;

/** Ends the PR comment that answers a round's items without a thread: one comment per round and head commit. */
export const itemAnswersMarker = (round: number, headSha: string) => `${HANDOFF_COMMENT_PREFIX}item-answers ${round} ${headSha} -->`;

/** The longest evidence a reply quotes. */
const EVIDENCE_LIMIT = 4_000;

/** What the evidence of all items in one PR comment may take together, well under GitHub's 65,536 characters. */
const COMMENT_EVIDENCE_BUDGET = 48_000;

/** The run's review items, by handle. */
export async function listItems(db: Db, runId: string): Promise<ReviewItemRow[]> {
  return db.select().from(reviewItems).where(eq(reviewItems.runId, runId)).orderBy(asc(reviewItems.handle));
}

/**
 * Adds a review item for each finding the run has none for yet, by key, with the next free handles in
 * the order of the findings, and returns all the run's items. A finding already an item is left alone:
 * the coder answers a comment once, not on every look at the pull request.
 */
export async function syncItems(db: Db, runId: string, findings: Finding[], round: number): Promise<ReviewItemRow[]> {
  const rows = await listItems(db, runId);
  const known = new Set(rows.map((r) => r.key));
  const fresh = findings.filter((f, i) => !known.has(f.key) && findings.findIndex((o) => o.key === f.key) === i);
  if (fresh.length === 0) return rows;
  let next = Math.max(0, ...rows.map((r) => r.handle)) + 1;
  await db
    .insert(reviewItems)
    .values(
      fresh.map((f) => ({
        runId,
        handle: next++,
        key: f.key,
        kind: f.kind,
        githubId: f.githubId ?? null,
        reviewer: f.author,
        reviewerBot: f.authorBot,
        path: f.path ?? null,
        line: f.line ?? null,
        body: f.body,
        url: f.url,
        round,
      })),
    )
    .onConflictDoNothing();
  return listItems(db, runId);
}

/**
 * The open items this round sends to the coder: those GitHub still shows among the findings, oldest
 * first, at most `max`. The rest wait for a later round. Each sent item records the round that sent it.
 */
export async function sendItems(db: Db, rows: ReviewItemRow[], findings: Finding[], round: number, max: number): Promise<ReviewItemRow[]> {
  const current = new Set(findings.map((f) => f.key));
  const sent = rows.filter((r) => r.state === "open" && current.has(r.key)).slice(0, max);
  if (sent.length) {
    await db.update(reviewItems).set({ round, updatedAt: sql`now()` }).where(inArray(reviewItems.id, sent.map((r) => r.id)));
  }
  return sent.map((r) => ({ ...r, round }));
}

/** Whether any finding is new, or an item still open: something a round would send to the coder. */
export async function hasUnsent(db: Db, runId: string, findings: Finding[]): Promise<boolean> {
  if (findings.length === 0) return false;
  const state = new Map((await listItems(db, runId)).map((r) => [r.key, r.state]));
  return findings.some((f) => (state.get(f.key) ?? "open") === "open");
}

/** Feedback that asks for changes with exactly these items, each with its handle, for the coder to answer. */
export function withItems(feedback: Feedback, items: ReviewItemRow[]): Feedback {
  return {
    ...feedback,
    review: {
      ...feedback.review,
      decision: "changes_requested",
      comments: items.map((r) => ({
        author: r.reviewer,
        body: r.body,
        url: r.url ?? "",
        resolved: false,
        ...(r.path ? { path: r.path } : {}),
        ...(r.line ? { line: r.line } : {}),
        item: handleOf(r),
        kind: r.kind,
      })),
    },
  };
}

/** The full commit a coder named, as the worktree knows it; the name as given when it cannot tell. */
async function fullCommit(workdir: string | undefined, commit: string): Promise<string> {
  if (!workdir) return commit;
  try {
    return (await execFileAsync("git", ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], { cwd: workdir })).stdout.trim() || commit;
  } catch {
    return commit;
  }
}

/**
 * Records the coder's answers to the items the PR node's last completed step sent: run state keeps them
 * under `reviewAnswers`, by handle, with the PR step that sent them. An item already answered on GitHub
 * keeps what it has. Recording again is harmless, so a restarted step records the same answers.
 */
export async function recordAnswers(db: Db, ctx: Pick<ExecutorContext, "run" | "node" | "state" | "workdir">): Promise<void> {
  const sender = (ctx.state as RunState).nodes[ctx.node.key];
  if (!sender) return;
  const answers = Object.entries(recordedAnswers(ctx.state)).filter(([, a]) => a.round === sender.executionId);
  if (answers.length === 0) return;
  const rows = new Map((await listItems(db, ctx.run.id)).map((r) => [handleOf(r), r]));
  for (const [handle, answer] of answers) {
    const row = rows.get(handle);
    if (!row || row.round !== sender.attempt || (row.state !== "open" && row.state !== "answered")) continue;
    const of = answer.of ? rows.get(answer.of) : undefined;
    await db
      .update(reviewItems)
      .set({
        verdict: answer.verdict,
        evidence: answer.evidence,
        fixCommit: answer.verdict === "fixed" && answer.commit ? await fullCommit(ctx.workdir?.path, answer.commit) : null,
        duplicateOf: answer.verdict === "duplicate" && of ? of.handle : null,
        state: "answered",
        stateReason: null,
        updatedAt: sql`now()`,
      })
      .where(eq(reviewItems.id, row.id));
  }
}

/** Text cut to `limit` characters, saying so when it was cut. */
function cut(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, Math.max(0, limit - 20)).trimEnd()}\n\n(cut at ${limit} characters)`;
}

/** Where an item is, as a link a reviewer can follow. */
function itemLink(item: ReviewItemRow): string {
  const what =
    item.kind === "thread"
      ? `the comment on \`${item.line ? `${item.path}:${item.line}` : item.path}\``
      : item.kind === "review_body"
        ? `the review by ${item.reviewer}`
        : item.kind === "summary_note"
          ? "the summary note"
          : "the pre-merge check";
  return item.url ? `[${what}](${item.url})` : what;
}

/**
 * An item's answer as handoff posts it: its first line says what the coder found ("Valid. Fixed in
 * <commit>.", "Not changed: the comment does not hold.", "Unclear: <question>", or "Same point as <link>."),
 * and the evidence follows as the coder wrote it, cut at `limit`.
 */
export function answerText(item: ReviewItemRow, items: ReviewItemRow[], repo: RepoRef, limit = EVIDENCE_LIMIT): string {
  const evidence = cut(item.evidence ?? "", limit);
  const withEvidence = (first: string) => (evidence ? `${first}\n\n${evidence}` : first);
  switch (item.verdict) {
    case "fixed": {
      const commit = item.fixCommit ?? "";
      return withEvidence(`Valid. Fixed in [${commit.slice(0, 7)}](https://github.com/${repo.owner}/${repo.name}/commit/${commit}).`);
    }
    case "unclear":
      return `Unclear: ${evidence}`;
    case "duplicate": {
      const other = items.find((i) => i.handle === item.duplicateOf);
      return withEvidence(`Same point as ${other ? itemLink(other) : "another comment"}.`);
    }
    default:
      return withEvidence("Not changed: the comment does not hold.");
  }
}

/** handoff's reply in an item's thread. */
export function replyBody(item: ReviewItemRow, items: ReviewItemRow[], ctx: { repo: RepoRef; runId: string; headSha: string; resolveAfterReview: boolean }): string {
  const after = ctx.resolveAfterReview ? " handoff resolves this thread after the reviewer's next review, unless that review raises it again." : "";
  return [answerText(item, items, ctx.repo), "", `<sub>Answered by handoff run \`${ctx.runId}\`.${after}</sub>`, itemReplyMarker(item.handle, ctx.headSha)].join("\n");
}

/** A finding's text on one line, short enough to name it in a PR comment. */
function excerpt(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

const KIND_LABELS = { thread: "Comment", review_body: "Review", summary_note: "Summary note", pre_merge_check: "Pre-merge check" } as const;

/** The PR comment that answers one round's items without a thread, one paragraph per item. */
export function roundCommentBody(round: ReviewItemRow[], items: ReviewItemRow[], ctx: { repo: RepoRef; runId: string; headSha: string; round: number }): string {
  const limit = Math.min(EVIDENCE_LIMIT, Math.floor(COMMENT_EVIDENCE_BUDGET / Math.max(1, round.length)));
  const parts = round.map((item) => [`**${KIND_LABELS[item.kind]} by ${item.reviewer}:** ${excerpt(item.body)}`, "", answerText(item, items, ctx.repo, limit)].join("\n"));
  return [
    "Answers to the review comments on this pull request that have no thread.",
    "",
    ...parts.flatMap((p) => [p, ""]),
    `<sub>Answered by handoff run \`${ctx.runId}\`.</sub>`,
    itemAnswersMarker(ctx.round, ctx.headSha),
  ].join("\n");
}

/** Records that an item's answer is on GitHub, in `comment`, for the head commit `headSha`. */
async function markPosted(db: Db, ids: string[], comment: { id: string; url: string }, headSha: string) {
  await db
    .update(reviewItems)
    .set({ replyCommentId: comment.id, replyUrl: comment.url, replyHeadSha: headSha, repliedAt: sql`now()`, state: "awaiting_review", stateReason: null, updatedAt: sql`now()` })
    .where(and(inArray(reviewItems.id, ids), eq(reviewItems.state, "answered")));
}

/**
 * Posts the answers of the run's answered items: a reply in the thread for a thread item, and one PR
 * comment per round for the others. Before it posts, it looks for its marker on GitHub (among the
 * thread's latest comments, or among the PR's comments), so a step that restarts after posting records
 * the comment it finds instead of posting again. A settled answer posts nothing. A post that fails is an
 * event; the item stays answered and the next look tries again.
 */
export async function postAnswers(
  deps: { db: Db; github: GitHubPort },
  ctx: Pick<ExecutorContext, "run" | "emit">,
  input: { repo: RepoRef; snapshot: PrSnapshot; headSha: string; resolveAfterReview: boolean },
): Promise<void> {
  const { db, github } = deps;
  const { repo, snapshot, headSha } = input;
  const items = await listItems(db, ctx.run.id);
  const answered = items.filter((i) => i.state === "answered" && i.verdict !== null && i.verdict !== "settled");
  const text = { repo, runId: ctx.run.id, headSha, resolveAfterReview: input.resolveAfterReview };

  for (const item of answered.filter((i) => i.kind === "thread")) {
    const thread = snapshot.reviewThreads.find((t) => t.id === item.githubId);
    if (!thread) {
      await db.update(reviewItems).set({ state: "gone", stateReason: "the thread is no longer on the pull request", updatedAt: sql`now()` }).where(eq(reviewItems.id, item.id));
      ctx.emit("github.item_gone", { item: handleOf(item), url: item.url });
      continue;
    }
    const marker = itemReplyMarker(item.handle, headSha);
    const found = thread.latest.find((c) => c.body.includes(marker));
    let comment = found ? { id: found.id ?? "", url: found.url } : undefined;
    if (!comment) {
      try {
        if (!thread.viewerCanReply) throw new Error("the credential handoff runs with may not reply in this thread");
        comment = await github.replyToThread(repo, thread.id, replyBody(item, items, text));
      } catch (error) {
        const message = (error as Error).message;
        await db.update(reviewItems).set({ stateReason: `reply failed: ${message}`, updatedAt: sql`now()` }).where(eq(reviewItems.id, item.id));
        ctx.emit("github.item_reply_failed", { item: handleOf(item), url: item.url, message });
        continue;
      }
    }
    await markPosted(db, [item.id], comment, headSha);
    ctx.emit("github.item_answered", { item: handleOf(item), verdict: item.verdict, url: comment.url, found: found !== undefined });
  }

  const rounds = [...new Set(answered.filter((i) => i.kind !== "thread").map((i) => i.round))];
  for (const round of rounds) {
    const these = answered.filter((i) => i.kind !== "thread" && i.round === round);
    const marker = itemAnswersMarker(round, headSha);
    try {
      // Finds the marker among all the PR's comments before it creates one, so a round is answered once.
      const { id, created } = await github.upsertPrComment(repo, snapshot.number, marker, roundCommentBody(these, items, { ...text, round }));
      const url = `${snapshot.url}#issuecomment-${id}`;
      await markPosted(db, these.map((i) => i.id), { id: String(id), url }, headSha);
      ctx.emit("github.items_answered", { round, items: these.map(handleOf), url, found: !created });
    } catch (error) {
      ctx.emit("github.items_answer_failed", { round, items: these.map(handleOf), message: (error as Error).message });
    }
  }
}

/** How many lines apart a reviewer's new thread may start and still be on an answered item's lines. */
const SAME_LINES = 3;

/** Why an item awaiting review no longer holds the PR step although handoff has not resolved it. */
export const CANNOT_RESOLVE = "cannot resolve: the credential handoff runs with may not resolve this thread";
export const REVIEWER_REPLIED = "the reviewer replied in the thread after the answer";

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

/**
 * When handoff's answer to an item reached GitHub, by GitHub's clock when the snapshot shows the answer
 * (the reply in the thread, or the PR comment of the round), else by the time handoff recorded it.
 */
function answeredAt(item: ReviewItemRow, snapshot: PrSnapshot, thread?: ReviewThread): number {
  const posted =
    item.kind === "thread"
      ? thread?.latest.find((c) => c.id !== undefined && c.id === item.replyCommentId)
      : snapshot.comments.find((c) => c.id !== undefined && String(c.id) === item.replyCommentId);
  const at = time(posted?.createdAt);
  return Number.isNaN(at) ? (item.repliedAt?.getTime() ?? 0) : at;
}

type ItemChange = Partial<typeof reviewItems.$inferInsert>;

async function change(db: Db, item: ReviewItemRow, set: ItemChange) {
  await db.update(reviewItems).set({ ...set, updatedAt: sql`now()` }).where(eq(reviewItems.id, item.id));
}

/** Records why an item no longer holds the step and says so in `event`, once for each reason. */
async function flag(db: Db, ctx: Pick<ExecutorContext, "emit">, item: ReviewItemRow, reason: string, event: string, payload: Record<string, unknown>) {
  if (item.stateReason === reason) return;
  await change(db, item, { stateReason: reason });
  item.stateReason = reason;
  ctx.emit(event, payload);
}

type Deps = { db: Db; github: GitHubPort };
type Ctx = Pick<ExecutorContext, "run" | "emit" | "execution">;

/**
 * Records an item as resolved by `by`, and with it every item it re-raised: their threads are resolved
 * on GitHub too, since the reviewer's new thread on the same lines took their place.
 */
async function resolveItem(deps: Deps, ctx: Ctx, repo: RepoRef, snapshot: PrSnapshot, items: ReviewItemRow[], item: ReviewItemRow, by: string, extra: Record<string, unknown> = {}) {
  await change(deps.db, item, { state: "resolved", stateReason: null, resolvedBy: by, resolvedAt: new Date() });
  ctx.emit("github.item_resolved", { item: handleOf(item), url: item.url, by, ...extra });
  for (const earlier of items.filter((i) => i.state === "reraised" && i.reraisedAs === item.handle)) {
    const thread = snapshot.reviewThreads.find((t) => t.id === earlier.githubId);
    if (thread && !thread.isResolved) {
      try {
        await deps.github.resolveThread(repo, thread.id);
      } catch (error) {
        const message = (error as Error).message;
        await change(deps.db, earlier, { stateReason: `cannot resolve: ${message}` });
        ctx.emit("github.thread_resolve_failed", { item: handleOf(earlier), url: earlier.url, thread: thread.id, message });
        continue;
      }
    }
    await resolveItem(deps, ctx, repo, snapshot, items, earlier, by);
  }
}

/** Whether a thread starts on the lines of an item's thread: the same file, within three lines of its line or original line. */
function onSameLines(other: ReviewThread, item: ReviewItemRow, thread: ReviewThread): boolean {
  const first = other.comments[0];
  const path = other.path || first?.path;
  if (!path || path !== (item.path ?? thread.path)) return false;
  const lines = (values: (number | null | undefined)[]) => values.filter((v): v is number => typeof v === "number");
  const theirs = lines([other.line, other.originalLine, first?.line]);
  const ours = lines([item.line, thread.line, thread.originalLine]);
  return theirs.some((a) => ours.some((b) => Math.abs(a - b) <= SAME_LINES));
}

const flagCannotResolve = (db: Db, ctx: Pick<ExecutorContext, "emit">, item: ReviewItemRow, thread: ReviewThread) =>
  flag(db, ctx, item, CANNOT_RESOLVE, "github.thread_resolve_failed", { item: handleOf(item), url: item.url, thread: thread.id, message: CANNOT_RESOLVE });

/**
 * The re-review checks of a thread item that awaits its reviewer's next review, in order: the thread was
 * resolved on GitHub (resolved, by whoever did it) or is gone; someone wrote in it after the answer (a
 * person other than the reviewer takes it over, `left`; the reviewer's reply is recorded for the coder's
 * next round); the reviewer opened a new thread on the same lines after the answer (the item is
 * `reraised` and follows the new one, which enters as a new item); the reviewer submitted a review after
 * the answer, on the answered commit or the head, so handoff resolves the thread. A review submitted
 * before the answer never counts, so a thread is never resolved in the execution that answered it.
 */
async function reReviewThread(deps: Deps, ctx: Ctx, repo: RepoRef, snapshot: PrSnapshot, items: ReviewItemRow[], item: ReviewItemRow) {
  const { db, github } = deps;
  const thread = snapshot.reviewThreads.find((t) => t.id === item.githubId);
  if (!thread) {
    await change(db, item, { state: "gone", stateReason: "the thread is no longer on the pull request" });
    ctx.emit("github.item_gone", { item: handleOf(item), url: item.url });
    return;
  }
  if (thread.isResolved) return resolveItem(deps, ctx, repo, snapshot, items, item, thread.resolvedBy ?? item.reviewer);

  const at = answeredAt(item, snapshot, thread);
  const after = thread.latest.filter((c) => c.id !== item.replyCommentId && !byHandoff(c.body) && time(c.createdAt) > at);
  const other = after.find((c) => !sameLogin(c.author, item.reviewer));
  if (other) {
    await change(db, item, { state: "left", stateReason: `${other.author} replied in the thread` });
    ctx.emit("github.item_left", { item: handleOf(item), by: other.author, url: other.url });
    return;
  }
  if (after.length) return flag(db, ctx, item, REVIEWER_REPLIED, "github.item_reviewer_replied", { item: handleOf(item), url: after.at(-1)!.url });

  const again = snapshot.reviewThreads.find((t) => {
    const first = t.comments[0];
    return t.id !== thread.id && first !== undefined && sameLogin(first.author, item.reviewer) && time(first.createdAt) > at && onSameLines(t, item, thread);
  });
  const finding = again ? threadFinding(again) : undefined;
  if (finding) {
    const next = (await syncItems(db, ctx.run.id, [finding], ctx.execution.attempt)).find((r) => r.key === finding.key)!;
    await change(db, item, { state: "reraised", stateReason: null, reraisedAs: next.handle });
    ctx.emit("github.item_reraised", { item: handleOf(item), as: handleOf(next), url: next.url });
    return;
  }

  const review = snapshot.reviews.find(
    (r) => sameLogin(r.author, item.reviewer) && r.state !== "PENDING" && time(r.submittedAt) > at && (r.commitSha === item.replyHeadSha || r.commitSha === snapshot.headSha),
  );
  if (!review) return;
  if (!thread.viewerCanResolve) return flagCannotResolve(db, ctx, item, thread);
  try {
    const { resolved } = await github.resolveThread(repo, thread.id);
    if (!resolved) throw new Error("GitHub did not report the thread resolved");
  } catch (error) {
    const message = (error as Error).message;
    return flag(db, ctx, item, `cannot resolve: ${message}`, "github.thread_resolve_failed", { item: handleOf(item), url: item.url, thread: thread.id, message });
  }
  // How long the reviewer took after the answer, so the default waits can be tuned.
  await resolveItem(deps, ctx, repo, snapshot, items, item, "handoff", { review: review.id, afterSeconds: Math.max(0, Math.round((time(review.submittedAt) - at) / 1000)) });
}

const normalised = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Looks at every item that awaits its reviewer's next review. A thread item goes through the checks of
 * `reReviewThread`. A review summary item is done (`next_review`) once the reviewer reviewed a later
 * commit after the answer without repeating it. A summary note or pre-merge check is done
 * (`summary_dropped`) once a summary of the head, edited after the answer, no longer lists it; one it
 * still lists stays as it is and is not sent again.
 */
export async function reReview(deps: Deps, ctx: Ctx, input: { repo: RepoRef; snapshot: PrSnapshot; summary?: { login: string; read: SummaryRead | undefined } | undefined }) {
  const { repo, snapshot, summary } = input;
  const items = await listItems(deps.db, ctx.run.id);
  for (const item of items.filter((i) => i.state === "awaiting_review")) {
    if (item.kind === "thread") {
      await reReviewThread(deps, ctx, repo, snapshot, items, item);
    } else if (item.kind === "review_body") {
      const at = answeredAt(item, snapshot);
      const original = snapshot.reviews.find((r) => r.id === item.githubId);
      const later = snapshot.reviews.filter((r) => sameLogin(r.author, item.reviewer) && time(r.submittedAt) > at && r.commitSha !== null && r.commitSha !== original?.commitSha);
      if (later.length && !later.some((r) => normalised(r.body) === normalised(item.body))) await resolveItem(deps, ctx, repo, snapshot, items, item, "next_review");
    } else if (summary?.read && summaryCoversHead(summary.read.summary, snapshot.headSha) && time(summary.read.comment.updatedAt) > answeredAt(item, snapshot)) {
      const listed = new Set(summaryFindings(summary.read, summary.login).map((f) => f.key));
      if (!listed.has(item.key)) await resolveItem(deps, ctx, repo, snapshot, items, item, "summary_dropped");
    }
  }
}

/**
 * The thread items the PR step waits on: answered on GitHub, awaiting the reviewer's next review, and
 * within the reviewer's limit (`until` is the earliest end). An item whose thread the credential may not
 * resolve no longer holds the step: an event names the thread, and the merge step's wait on unresolved
 * threads lists it. An item past its limit no longer holds it either; it is reported once and keeps its
 * state, for a person to decide.
 */
export async function awaitingReview(deps: Deps, ctx: Ctx, input: { snapshot: PrSnapshot; settings: ReviewThreadsSettings; now: number }) {
  const { snapshot, settings, now } = input;
  const items = (await listItems(deps.db, ctx.run.id)).filter((i) => i.state === "awaiting_review" && i.kind === "thread" && i.stateReason === null);
  const held: ReviewItemRow[] = [];
  const overdue: { item: ReviewItemRow; limitMinutes: number }[] = [];
  let until: number | undefined;
  for (const item of items) {
    const thread = snapshot.reviewThreads.find((t) => t.id === item.githubId);
    if (!thread) continue;
    if (!thread.viewerCanResolve) {
      await flagCannotResolve(deps.db, ctx, item, thread);
      continue;
    }
    const limit = item.reviewerBot ? settings.botWaitMs : settings.personWaitMs;
    const due = answeredAt(item, snapshot, thread) + limit;
    if (now >= due) {
      overdue.push({ item, limitMinutes: Math.round(limit / 60_000) });
      continue;
    }
    held.push(item);
    until = Math.min(until ?? Infinity, due);
  }
  for (const { item, limitMinutes } of overdue) await change(deps.db, item, { stateReason: `no review from ${item.reviewer} within ${limitMinutes} minutes of the answer` });
  if (overdue.length) {
    ctx.emit("github.items_review_overdue", { items: overdue.map(({ item, limitMinutes }) => ({ item: handleOf(item), reviewer: item.reviewer, url: item.url, limitMinutes })) });
  }
  return { items: held, until };
}
