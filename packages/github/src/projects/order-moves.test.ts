import { expect, test } from "vitest";
import { orderMoves } from "./order-moves.ts";
import type { ItemMove } from "./types.ts";

/** What GitHub does with the moves: each item, in turn, goes right after `afterId`, or to the top for null. */
function apply(current: string[], moves: ItemMove[]): string[] {
  const order = [...current];
  for (const { itemId, afterId } of moves) {
    order.splice(order.indexOf(itemId), 1);
    order.splice(afterId === null ? 0 : order.indexOf(afterId) + 1, 0, itemId);
  }
  return order;
}

test("moving one task to the front is one move after nothing", () => {
  expect(orderMoves(["a", "b", "c", "d"], ["d", "a", "b", "c"])).toEqual([{ itemId: "d", afterId: null }]);
});

test("items already in order are not moved and each moved item goes after its new predecessor", () => {
  expect(orderMoves(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
  // a, b, d, e, f and g keep their order; c goes to the top and h after d.
  expect(orderMoves(["a", "b", "c", "d", "e", "f", "g", "h"], ["c", "a", "b", "d", "h", "e", "f", "g"])).toEqual([
    { itemId: "c", afterId: null },
    { itemId: "h", afterId: "d" },
  ]);
  // Moving a task down past two others is one move too.
  expect(orderMoves(["a", "b", "c", "d"], ["b", "c", "a", "d"])).toEqual([{ itemId: "a", afterId: "c" }]);
});

test("applying the moves to the current order gives the next order", () => {
  const current = Array.from({ length: 30 }, (_, i) => `PVTI_${i}`);
  // A small seeded generator, so the shuffles are the same on every run.
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let round = 0; round < 200; round++) {
    const next = [...current];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [next[i], next[j]] = [next[j]!, next[i]!];
    }
    const moves = orderMoves(current, next);
    expect(apply(current, moves)).toEqual(next);
    expect(moves.length).toBeLessThan(current.length);
  }
  // A reversed order keeps one item and moves every other one.
  const reversed = [...current].reverse();
  expect(apply(current, orderMoves(current, reversed))).toEqual(reversed);
  expect(orderMoves(current, reversed)).toHaveLength(current.length - 1);
});

test("orderMoves refuses orders that do not hold the same items", () => {
  expect(() => orderMoves(["a", "b"], ["a", "c"])).toThrow(/same items/);
  expect(() => orderMoves(["a", "b"], ["a", "b", "b"])).toThrow(/same items/);
});
