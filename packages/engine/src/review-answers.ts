import { PrOutputSchema, ReviewAnswerSchema, type CompiledGraph, type ReviewAnswer, type ReviewItem, type RunState } from "@handoff/core";
import { sameLogin } from "./executors/external-review.ts";

/** A review item a PR step sent to the coder, with whether the reviewer wrote in its thread after the first comment. */
export type SentItem = ReviewItem & { replied: boolean };

/**
 * The review items one PR step's output sent back: `round` is that PR execution's id, and `headSha` the
 * commit it pushed, which the coder started the round from.
 */
export type ReviewRound = { source: string; round: string; headSha: string; items: SentItem[] };

/** A coder's answer as run state keeps it under `reviewAnswers`, by handle, with the round it answered. */
export type RecordedAnswer = ReviewAnswer & { round: string };

/** The PR steps whose edges send work back to this node: the ones whose review items it answers. */
export function reviewSourcesOf(graph: CompiledGraph, nodeKey: string): string[] {
  return [...new Set(graph.inEdges(nodeKey).flatMap((e) => (graph.node(e.source).type === "pr" ? [e.source] : [])))];
}

/** The review items the latest output of one of `sources` carries, or undefined when none carries any. */
export function reviewRoundOf(state: RunState, sources: string[]): ReviewRound | undefined {
  for (const source of sources) {
    const result = state.nodes[source];
    const parsed = PrOutputSchema.safeParse(result?.output);
    if (!result || !parsed.success) continue;
    const items = parsed.data.feedback.review.comments.flatMap((c): SentItem[] =>
      c.item
        ? [
            {
              id: c.item,
              ...(c.kind ? { kind: c.kind } : {}),
              author: c.author,
              ...(c.path ? { path: c.path } : {}),
              ...(c.line !== undefined ? { line: c.line } : {}),
              url: c.url,
              body: c.body,
              ...(c.conversation?.length ? { conversation: c.conversation } : {}),
              replied: (c.conversation ?? []).some((r) => sameLogin(r.author, c.author)),
            },
          ]
        : [],
    );
    if (items.length) return { source, round: result.executionId, headSha: parsed.data.headSha, items };
  }
  return undefined;
}

/** The answers run state holds, by handle. */
export function recordedAnswers(state: RunState): Record<string, RecordedAnswer> {
  const raw = (state as { reviewAnswers?: unknown }).reviewAnswers;
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([id, value]) => {
      const answer = ReviewAnswerSchema.safeParse(value);
      const round = (value as { round?: unknown }).round;
      return answer.success && typeof round === "string" ? [[id, { ...answer.data, round }]] : [];
    }),
  );
}

/**
 * The items of the latest round that no coder attempt has answered yet, or undefined when there are
 * none. An attempt the tester or a gate sent back in a round the coder already answered gets none.
 */
export function itemsToAnswer(state: RunState, sources: string[]): ReviewRound | undefined {
  const round = reviewRoundOf(state, sources);
  if (!round) return undefined;
  const answered = recordedAnswers(state);
  const items = round.items.filter((item) => answered[item.id]?.round !== round.round);
  return items.length ? { ...round, items } : undefined;
}

/** The answers an output gives, read leniently: what the contract parsed, or nothing. */
export function answersOf(output: unknown): ReviewAnswer[] {
  const raw = (output as { answers?: unknown } | undefined)?.answers;
  return Array.isArray(raw) ? raw.flatMap((a) => (ReviewAnswerSchema.safeParse(a).success ? [a as ReviewAnswer] : [])) : [];
}

/**
 * Run state's `reviewAnswers` with this attempt's answers to the round's items added, each replacing an
 * earlier answer to the same item. Undefined when the attempt answered none of them.
 */
export function withAnswers(state: RunState, round: ReviewRound | undefined, answers: ReviewAnswer[]): Record<string, RecordedAnswer> | undefined {
  if (!round) return undefined;
  const known = new Set(round.items.map((i) => i.id));
  const added = answers.filter((a) => known.has(a.id));
  if (!added.length) return undefined;
  return { ...recordedAnswers(state), ...Object.fromEntries(added.map((a) => [a.id, { ...a, round: round.round }])) };
}

/** Verdicts that change nothing on the branch. */
const NO_CHANGE = new Set(["declined", "unclear", "duplicate", "settled"]);

/** Whether every answer leaves the code as it was, so the round needs no tests or reviews again. */
export const changesNothing = (answers: ReviewAnswer[]) => answers.length > 0 && answers.every((a) => NO_CHANGE.has(a.verdict));

