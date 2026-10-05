import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Feedback, RunState } from "@handoff/core";
import { and, asc, eq, inArray, reviewItems, sql, type Db, type ReviewItemRow } from "@handoff/db";
import { HANDOFF_COMMENT_PREFIX, type GitHubPort, type PrSnapshot, type RepoRef } from "@handoff/github";
import { recordedAnswers } from "../review-answers.ts";
import type { ExecutorContext } from "../types.ts";
import { sameLogin, type Finding } from "./external-review.ts";

/**
 * Review items: the findings a PR node sends to the coder with a handle (`R1`), the coder's answers,
 * and handoff's answers on GitHub. The PR node is the only writer of `review_items`.
 *
 * Plan: docs/plans/review-threads.md, Decisions 1, 3 and 7. Re-review and resolving (Decision 5) and a
 * person's choice (Decision 8) build on the rows' `awaiting_review` state and reply columns.
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

/**
 * The reviewers a PR step waits for after an answer-only round, each with its items: the authors of the
 * threads it answered on the head commit who have not submitted a review since the reply. Their next
 * review says whether they accept the answers. The reply's time is GitHub's, so only GitHub's clock is
 * compared; a reply GitHub no longer lists among the thread's latest comments falls back to when
 * handoff recorded it.
 */
export async function awaitingNextReview(db: Db, runId: string, snapshot: PrSnapshot): Promise<{ reviewer: string; items: string[] }[]> {
  const answered = (await listItems(db, runId)).filter((i) => i.state === "awaiting_review" && i.kind === "thread" && i.replyHeadSha === snapshot.headSha);
  const waiting = new Map<string, string[]>();
  for (const item of answered) {
    const reply = snapshot.reviewThreads.find((t) => t.id === item.githubId)?.latest.find((c) => c.id === item.replyCommentId);
    const since = Date.parse(reply?.createdAt ?? "") || (item.repliedAt?.getTime() ?? 0);
    // GitHub's times are to the second: a review in the same second as the reply counts as after it.
    const reviewed = snapshot.reviews.some((r) => sameLogin(r.author, item.reviewer) && r.submittedAt !== null && Date.parse(r.submittedAt) >= since);
    if (!reviewed) waiting.set(item.reviewer, [...(waiting.get(item.reviewer) ?? []), handleOf(item)]);
  }
  return [...waiting].map(([reviewer, items]) => ({ reviewer, items }));
}
