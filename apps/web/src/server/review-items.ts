import { splitCommits } from "@handoff/core";
import { and, asc, desc, eq, events, inArray, nodeExecutions, reviewItems, type DbExecutor } from "@handoff/db";
import type { ReviewItemView } from "../lib/review-items";
import type { ReReviewer } from "../lib/reviewers";

const handle = (n: number | null) => (n === null ? null : `R${n}`);

/**
 * What a PR step waits on after handoff answered review comments, while its latest look ended on
 * github.rereview: the reviewers, how many answered comments wait, since when (the earliest answer), when
 * the first wait ends and a person is asked (`until`), and each item's end (`due`, by handle).
 */
export type ReReviewState = { nodeExecutionId: string; reviewers: ReReviewer[]; items: number; since: Date; until: Date | null; due: Record<string, string> };

type ReReviewPayload = { waitingFor?: unknown; items?: unknown; until?: unknown; due?: unknown };

/**
 * The re-review wait of each run whose PR step waits for a reviewer's next review, keyed by run id. A look
 * at the pull request starts with github.pr and ends with github.rereview when answers hold the step, so
 * the step waits on re-review while its latest github.rereview is newer than its latest github.pr.
 */
export async function reReviewWaits(db: DbExecutor, runIds: string[]): Promise<Map<string, ReReviewState>> {
  const waits = new Map<string, ReReviewState>();
  if (runIds.length === 0) return waits;
  const latest = await db
    .selectDistinctOn([events.nodeExecutionId, events.type], { runId: events.runId, nodeExecutionId: events.nodeExecutionId, type: events.type, seq: events.seq, payload: events.payload, createdAt: events.createdAt })
    .from(events)
    .innerJoin(nodeExecutions, eq(nodeExecutions.id, events.nodeExecutionId))
    .where(and(inArray(events.runId, runIds), inArray(events.type, ["github.pr", "github.rereview"]), eq(nodeExecutions.status, "waiting"), eq(nodeExecutions.waitKind, "github_pr")))
    .orderBy(events.nodeExecutionId, events.type, desc(events.seq));
  const lastPr = new Map(latest.filter((e) => e.type === "github.pr").map((e) => [e.nodeExecutionId, e.seq]));
  const looks = latest.filter((e) => e.type === "github.rereview" && e.seq > (lastPr.get(e.nodeExecutionId) ?? 0));
  if (looks.length === 0) return waits;
  const rows = await db
    .select({ runId: reviewItems.runId, handle: reviewItems.handle, reviewer: reviewItems.reviewer, reviewerBot: reviewItems.reviewerBot, repliedAt: reviewItems.repliedAt })
    .from(reviewItems)
    .where(inArray(reviewItems.runId, looks.map((l) => l.runId)));
  for (const look of looks) {
    const payload = (look.payload ?? {}) as ReReviewPayload;
    const handles = new Set(Array.isArray(payload.items) ? payload.items.map(String) : []);
    const logins = Array.isArray(payload.waitingFor) ? payload.waitingFor.map(String) : [];
    const mine = rows.filter((r) => r.runId === look.runId);
    const waiting = mine.filter((r) => handles.has(`R${r.handle}`));
    const answered = waiting.flatMap((r) => (r.repliedAt ? [r.repliedAt.getTime()] : []));
    waits.set(look.runId, {
      nodeExecutionId: look.nodeExecutionId!,
      reviewers: logins.map((login) => ({ login, bot: mine.some((r) => r.reviewer === login && r.reviewerBot) })),
      items: handles.size,
      since: answered.length ? new Date(Math.min(...answered)) : look.createdAt,
      until: typeof payload.until === "string" ? new Date(payload.until) : null,
      due: typeof payload.due === "object" && payload.due !== null ? (payload.due as Record<string, string>) : {},
    });
  }
  return waits;
}

/**
 * For the merge step's unresolved threads card: the thread items that are a person's now, by thread URL,
 * with the item's handle and why: left to a person, or a thread handoff could not resolve.
 */
export function threadNotes(items: ReviewItemView[]): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const item of items) {
    if (item.kind !== "thread" || !item.url) continue;
    if (item.state === "left") notes[item.url] = `${item.id}, left to you`;
    else if (item.state === "awaiting_review" && item.stateReason) notes[item.url] = `${item.id}, handoff cannot resolve it`;
    else if (item.state === "disputed") notes[item.url] = `${item.id}, needs your decision`;
  }
  return notes;
}

/**
 * The run's review items as the run page shows them, by handle: the reviewer's comment, the coder's
 * verdict and evidence, the fixing commit with its link on GitHub, handoff's reply, and where each stands.
 * With the step's re-review wait, an item it waits on says when the wait ends.
 */
export async function runReviewItems(db: DbExecutor, runId: string, repo: { owner: string; name: string }, wait?: ReReviewState): Promise<ReviewItemView[]> {
  const rows = await db.select().from(reviewItems).where(eq(reviewItems.runId, runId)).orderBy(asc(reviewItems.handle));
  return rows.map((r) => {
    const id = `R${r.handle}`;
    // fix_commit lists every commit of a fix separated by spaces; the run page links the first.
    const [commit] = splitCommits(r.fixCommit);
    return {
      id,
      kind: r.kind,
      reviewer: r.reviewer,
      reviewerBot: r.reviewerBot,
      path: r.path,
      line: r.line,
      url: r.url,
      outdated: r.outdated,
      body: r.body,
      round: r.round,
      verdict: r.verdict,
      evidence: r.evidence,
      commit: commit ?? null,
      commitUrl: commit ? `https://github.com/${repo.owner}/${repo.name}/commit/${commit}` : null,
      duplicateOf: handle(r.duplicateOf),
      replyUrl: r.replyUrl,
      repliedAt: r.repliedAt?.toISOString() ?? null,
      waitUntil: r.state === "awaiting_review" ? (wait?.due[id] ?? null) : null,
      state: r.state,
      stateReason: r.stateReason,
      resolvedBy: r.resolvedBy,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      reraisedAs: handle(r.reraisedAs),
    };
  });
}
