import type { PlanItem } from "@handoff/github";

/** The cards of one story in the flow's order; a task right under an epic, with no story, chains under its epic. */
export type StoryChain = { parent: number; issues: number[] };

/** From a card to the next card of its story. */
export type ThenLink = { from: number; to: number };

/** What storyChains reads of a card: its task, its start, and whether it runs. */
type ChainCard = { issue: number; kind: "running" | "next" | "shaping"; lane: number; start: number };

/**
 * Each story's cards in the flow's order (issue #543): by start, then running cards by slot, then by place in the
 * queue when two start together. Only tasks with a card take part, so done, skipped and waiting tasks drop out
 * and the chain joins the cards on either side of them. A task whose parent is not a story or an epic of the plan
 * chains with nothing. The chains come in the order of their first card.
 */
export function storyChains(cards: readonly ChainCard[], queue: readonly number[], items: readonly PlanItem[]): StoryChain[] {
  const byNumber = new Map(items.map((i) => [i.number, i]));
  const place = new Map(queue.map((n, index) => [n, index]));
  const rank = (c: ChainCard) => (c.kind === "running" ? -1 : (place.get(c.issue) ?? queue.length));
  const ordered = [...cards].sort((a, b) => a.start - b.start || rank(a) - rank(b) || a.lane - b.lane);
  const chains = new Map<number, number[]>();
  for (const card of ordered) {
    const parent = byNumber.get(card.issue)?.parent;
    const kind = parent === undefined ? undefined : byNumber.get(parent)?.kind;
    if (parent === undefined || (kind !== "story" && kind !== "epic")) continue;
    chains.set(parent, [...(chains.get(parent) ?? []), card.issue]);
  }
  return [...chains].map(([parent, issues]) => ({ parent, issues }));
}

/** Each card to the next card of its chain, except where the next is blocked by the one before it: the blocker arrow already joins them. */
export function thenLinks(chains: readonly StoryChain[], items: readonly PlanItem[]): ThenLink[] {
  const blockers = new Map(items.map((i) => [i.number, new Set(i.blockedBy)]));
  return chains.flatMap(({ issues }) =>
    issues.slice(1).flatMap((to, index) => {
      const from = issues[index]!;
      return blockers.get(to)?.has(from) ? [] : [{ from, to }];
    }),
  );
}

/** A card's box on the order axis: its left and right edges, and the middle of its row. */
type Box = { left: number; right: number; y: number };

/** A pixel to one decimal, as the path says it. */
const px = (v: number) => Math.round(v * 10) / 10;

/** A then arrow needs this much run along the next card's row; with less, it drops into the card's top. */
const MIN_RUN = 6;

/**
 * A then arrow's line and open head (issue #543), from under a card of `half` its height to the next card of its
 * story. When the next card starts after this one ends, the line leaves 4 px before this card's end; when the two
 * run side by side, 12 px before the next card starts, never closer than 4 px to this card's start, so it never
 * points back in time. It drops to the next card's row and runs along it into the card's start. When the two
 * start together there is no room to run, and it drops into the next card's top. A next card on a row above is
 * reached from this card's top.
 */
export function thenPath(from: Box, to: Box, half: number): { d: string; head: string } {
  const down = to.y >= from.y ? 1 : -1;
  const y1 = from.y + down * half;
  const x = Math.max(from.left + 4, Math.min(from.right - 4, to.left - 12));
  if (to.left - x >= MIN_RUN) {
    const tip = to.left - 1;
    return {
      d: `M${px(x)} ${px(y1)} V${px(to.y)} H${px(tip)}`,
      head: `M${px(tip - 3.5)} ${px(to.y - 3)} L${px(tip)} ${px(to.y)} L${px(tip - 3.5)} ${px(to.y + 3)}`,
    };
  }
  const drop = to.left + 5;
  const y2 = to.y - down * (half + 1);
  return {
    d: `M${px(drop)} ${px(y1)} V${px(y2)}`,
    head: `M${px(drop - 3)} ${px(y2 - down * 3.5)} L${px(drop)} ${px(y2)} L${px(drop + 3)} ${px(y2 - down * 3.5)}`,
  };
}

/** Where a task sits in its story's chain: its chain, its place from 1, and the task after it. */
export function chainPlace(chains: readonly StoryChain[], issue: number): { chain: StoryChain; place: number; next: number | undefined } | undefined {
  for (const chain of chains) {
    const index = chain.issues.indexOf(issue);
    if (index !== -1) return { chain, place: index + 1, next: chain.issues[index + 1] };
  }
  return undefined;
}
