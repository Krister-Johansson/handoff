import { expect, test } from "vitest";
import { thenPath } from "./story-order";

/** A card's box on the axis, on a row whose middle is `y`. */
const box = (left: number, width: number, y: number) => ({ left, right: left + width, y });

test("a then arrow leaves from under the end of a card into the start of the next one that starts after it ends", () => {
  expect(thenPath(box(10, 84, 23), box(104, 84, 69), 11)).toEqual({ d: "M90 34 V69 H103", head: "M99.5 66 L103 69 L99.5 72" });
});

test("a then arrow leaves just before the next card starts when the two run side by side", () => {
  expect(thenPath(box(10, 84, 23), box(52, 84, 69), 11)).toEqual({ d: "M40 34 V69 H51", head: "M47.5 66 L51 69 L47.5 72" });
  // Close to the card's start, it leaves 4 px in from it.
  expect(thenPath(box(10, 84, 23), box(22, 84, 69), 11).d).toBe("M14 34 V69 H21");
});

test("a then arrow drops into the top of a card that starts together with it", () => {
  expect(thenPath(box(20, 84, 23), box(20, 84, 69), 11)).toEqual({ d: "M25 34 V57", head: "M22 53.5 L25 57 L28 53.5" });
});

test("a then arrow to a row above leaves from the top of the card", () => {
  expect(thenPath(box(10, 84, 69), box(104, 84, 23), 11)).toEqual({ d: "M90 58 V23 H103", head: "M99.5 20 L103 23 L99.5 26" });
  expect(thenPath(box(20, 84, 69), box(20, 84, 23), 11)).toEqual({ d: "M25 58 V35", head: "M22 38.5 L25 35 L28 38.5" });
});
