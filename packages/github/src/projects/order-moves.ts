import type { ItemMove } from "./types.ts";

/**
 * The fewest moves that turn Project order `current` into `next`, both lists of the same item ids. The
 * longest run of items already in order stays; every other item moves, in `next` order, right after the
 * item before it in `next` (to the top when it is first). Applied one after another, the moves give `next`.
 */
export function orderMoves(current: string[], next: string[]): ItemMove[] {
  const at = new Map(current.map((id, index) => [id, index]));
  if (at.size !== current.length || next.length !== current.length || new Set(next).size !== next.length || next.some((id) => !at.has(id))) {
    throw new Error("orderMoves needs two orders of the same items");
  }
  const kept = longestIncreasing(next.map((id) => at.get(id)!));
  return next.flatMap((itemId, index) => (kept.has(index) ? [] : [{ itemId, afterId: index === 0 ? null : next[index - 1]! }]));
}

/** The indexes into `values` of one longest strictly increasing subsequence, in O(n log n). */
function longestIncreasing(values: number[]): Set<number> {
  // tails[k] is the index of the smallest value that ends an increasing run of length k + 1.
  const tails: number[] = [];
  const previous: number[] = [];
  values.forEach((value, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]!]! < value) low = middle + 1;
      else high = middle;
    }
    previous[index] = low > 0 ? tails[low - 1]! : -1;
    tails[low] = index;
  });
  const kept = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index]!) kept.add(index);
  return kept;
}

/**
 * One mutation request for several moves: an `updateProjectV2ItemPosition` per move, aliased `m<n>` from
 * 1 with the variables `m<n>Item` and `m<n>After`, in the order given. GitHub runs a request's mutations
 * one after another, so a move may name an item an earlier move placed. The caller adds `projectId`.
 */
export function moveItemsDocument(moves: ItemMove[]): { document: string; variables: Record<string, unknown> } {
  const declarations = ["$projectId: ID!"];
  const selections: string[] = [];
  const variables: Record<string, unknown> = {};
  moves.forEach(({ itemId, afterId }, index) => {
    const name = `m${index + 1}`;
    declarations.push(`$${name}Item: ID!`, `$${name}After: ID`);
    variables[`${name}Item`] = itemId;
    variables[`${name}After`] = afterId;
    selections.push(`  ${name}: updateProjectV2ItemPosition(input: { projectId: $projectId, itemId: $${name}Item, afterId: $${name}After }) { clientMutationId }`);
  });
  return { document: `mutation MovePlanItems(${declarations.join(", ")}) {\n${selections.join("\n")}\n}`, variables };
}
