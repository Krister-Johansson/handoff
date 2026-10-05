import type { StatusTone } from "./status";

export type ReviewItemKind = "thread" | "review_body" | "summary_note" | "pre_merge_check";
export type ReviewVerdict = "fixed" | "declined" | "unclear" | "duplicate" | "settled";
export type ReviewItemState = "open" | "answered" | "awaiting_review" | "resolved" | "disputed" | "reraised" | "left" | "gone";

/**
 * A review item as the run page shows it: what a reviewer said on the run's pull request, the coder's
 * answer, handoff's reply on GitHub, and where it stands. Handles (`R1`) name items, as in `duplicateOf`
 * and `reraisedAs`. Times are ISO strings; `waitUntil` is when handoff stops waiting for the reviewer.
 */
export type ReviewItemView = {
  id: string;
  kind: ReviewItemKind;
  reviewer: string;
  reviewerBot: boolean;
  path: string | null;
  line: number | null;
  url: string | null;
  outdated: boolean;
  body: string;
  round: number;
  verdict: ReviewVerdict | null;
  evidence: string | null;
  commit: string | null;
  commitUrl: string | null;
  duplicateOf: string | null;
  replyUrl: string | null;
  repliedAt: string | null;
  waitUntil: string | null;
  state: ReviewItemState;
  stateReason: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  reraisedAs: string | null;
};

/** How each verdict reads, and its tag's look: fixed green, declined grey, unclear amber, duplicate dashed, settled outlined in green. */
export const VERDICTS: Record<ReviewVerdict, { label: string; className: string }> = {
  fixed: { label: "Fixed", className: "border-transparent bg-success-bg text-success" },
  declined: { label: "Declined", className: "border-transparent bg-secondary text-secondary-foreground" },
  unclear: { label: "Unclear", className: "border-transparent bg-attention-bg text-attention" },
  duplicate: { label: "Duplicate", className: "border-dashed text-muted-foreground" },
  settled: { label: "Settled", className: "border-success-dot/50 text-success" },
};

export const isVerdict = (value: unknown): value is ReviewVerdict => typeof value === "string" && value in VERDICTS;

/** What kind of finding an item is, for an item without a file and line. */
export const KIND_TAGS: Record<ReviewItemKind, string> = { thread: "thread", review_body: "review summary", summary_note: "walkthrough note", pre_merge_check: "pre-merge check" };

/** Where an item points: its file and line, or null for a finding without one. */
export const itemPlace = (item: { path: string | null; line: number | null }) => (item.path ? (item.line !== null ? `${item.path}:${item.line}` : item.path) : null);

/** The first line of a comment, and the rest on one line. */
export function splitComment(body: string): { title: string; rest: string } {
  const [title = "", ...rest] = body.trim().split("\n");
  return { title: title.trim(), rest: rest.join(" ").trim() };
}

/** Who or what resolved an item, as its detail line says it. */
export const resolvedHow = (by: string | null) => (by === "summary_dropped" ? "dropped from the summary" : by === "next_review" ? "not repeated in the next review" : by ? `by ${by}` : "");

/** The card's groups, in order, by where an item comes from; unresolved items first in each. */
export function groupsOf(items: ReviewItemView[]) {
  const fromSummary = (i: ReviewItemView) => i.kind === "summary_note" || i.kind === "pre_merge_check";
  const summaryBots = [...new Set(items.filter(fromSummary).map((i) => i.reviewer))];
  const groups = [
    { name: "Threads", note: undefined as string | undefined, items: items.filter((i) => i.kind === "thread") },
    { name: "Review summaries", note: "answered in one PR comment per round", items: items.filter((i) => i.kind === "review_body") },
    ...summaryBots.map((bot) => ({ name: `${bot}'s summary comment`, note: "does not hold the merge", items: items.filter((i) => fromSummary(i) && i.reviewer === bot) })),
  ];
  const rank = (i: ReviewItemView) => (i.state === "resolved" ? 1 : 0);
  return groups.filter((g) => g.items.length > 0).map((g) => ({ ...g, items: g.items.toSorted((a, b) => rank(a) - rank(b)) }));
}

/** How many items stand where, in the words of the card's summary and its footer. */
const TALLY: { label: string; tone: StatusTone; states: ReviewItemState[] }[] = [
  { label: "with the coder", tone: "active", states: ["open"] },
  { label: "answer ready", tone: "active", states: ["answered"] },
  { label: "waiting for a review", tone: "active", states: ["awaiting_review"] },
  { label: "need you", tone: "attention", states: ["disputed"] },
  { label: "resolved", tone: "success", states: ["resolved"] },
  { label: "other", tone: "muted", states: ["reraised", "left", "gone"] },
];

export function tallyOf(items: ReviewItemView[]) {
  return TALLY.map((t) => ({ ...t, n: items.filter((i) => t.states.includes(i.state)).length })).filter((t) => t.n > 0);
}

/** One line: how many comments, and how many stand where. */
export function reviewSummary(items: ReviewItemView[]): string {
  const parts = tallyOf(items).map((t) => `${t.n} ${t.label}`);
  return `${items.length} ${items.length === 1 ? "comment" : "comments"}: ${parts.join(", ")}.`;
}

/** The coder's verdicts so far: "5 fixed, 2 declined". */
export function verdictCounts(items: { verdict: ReviewVerdict | null }[]): string {
  return (Object.keys(VERDICTS) as ReviewVerdict[])
    .map((v) => [v, items.filter((i) => i.verdict === v).length] as const)
    .filter(([, n]) => n > 0)
    .map(([v, n]) => `${n} ${v}`)
    .join(", ");
}
