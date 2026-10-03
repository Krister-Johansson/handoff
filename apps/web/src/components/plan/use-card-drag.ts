"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { layoutFlow, reorderFlow, type Flow, type FlowInput } from "@/lib/plan/flow";
import { keepPins, moveTo } from "@/lib/plan/flow-order";

/**
 * A move of a Flow card in progress: whose card, and what the gesture or the keys did so far. `dx` is how far
 * the pointer moved the card along the order axis in pixels; `steps` is how many places Alt and the arrows
 * moved it, negative for earlier.
 */
export type CardMove = { issue: number; via: "pointer" | "keys"; dx: number; steps: number };

/** Pixels a pointer moves before a press becomes a drag; less is a click. */
const SLOP = 3;
/** How long after the last Alt and arrow key the keyboard's move is saved. */
export const KEY_DELAY = 800;

type Gesture = { issue: number; x0: number; moved: boolean };

/** What Alt and an arrow do: Left and Up move a card one place earlier, Right and Down one place later. */
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

/**
 * Dragging Flow cards along the order axis with no drag library, as the timeline's bars drag: pointer events
 * on the card, one axis, the pointer captured while it is down. A drop, the last Alt and arrow after a pause,
 * or leaving the card hands the move to `onDrop`, which places it in the queue; Escape puts the card back.
 * The click that ends a drag does not open the card's issue.
 */
export function useCardDrag({ onDrop }: { onDrop: (move: CardMove) => void }) {
  const drop = useRef(onDrop);
  useEffect(() => {
    drop.current = onDrop;
  });
  const [move, setMoveState] = useState<CardMove>();
  const current = useRef<CardMove | undefined>(undefined);
  const gesture = useRef<Gesture | null>(null);
  const clickAfterDrag = useRef(false);
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(keyTimer.current), []);

  const setMove = (next: CardMove | undefined) => {
    current.current = next;
    setMoveState(next);
  };
  const cancel = () => {
    clearTimeout(keyTimer.current);
    // A drag put back with Escape still ends in a click on the card, which must not open the issue.
    if (gesture.current?.moved) clickAfterDrag.current = true;
    gesture.current = null;
    setMove(undefined);
  };
  const commit = () => {
    clearTimeout(keyTimer.current);
    const done = current.current;
    setMove(undefined);
    if (done && (done.dx !== 0 || done.steps !== 0)) drop.current(done);
  };

  /** What a card that drags spreads on its element. */
  const cardProps = (issue: number) => ({
    draggable: false,
    "aria-keyshortcuts": "Alt+ArrowLeft Alt+ArrowRight Escape",
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      clickAfterDrag.current = false;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      gesture.current = { issue, x0: e.clientX, moved: false };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.issue !== issue) return;
      const dx = e.clientX - g.x0;
      if (!g.moved && Math.abs(dx) < SLOP) return;
      g.moved = true;
      setMove({ issue, via: "pointer", dx, steps: 0 });
    },
    onPointerUp: () => {
      const g = gesture.current;
      gesture.current = null;
      if (!g?.moved) return;
      clickAfterDrag.current = true;
      commit();
    },
    onPointerCancel: cancel,
    onClick: (e: MouseEvent<HTMLElement>) => {
      // The click that ends a drag does not open the issue.
      if (clickAfterDrag.current) e.preventDefault();
      clickAfterDrag.current = false;
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Escape" && current.current?.issue === issue) {
        e.preventDefault();
        cancel();
        return;
      }
      const step = STEP[e.key];
      if (!e.altKey || step === undefined) return;
      e.preventDefault();
      const was = current.current?.issue === issue && current.current.via === "keys" ? current.current : { issue, via: "keys" as const, dx: 0, steps: 0 };
      setMove({ ...was, steps: was.steps + step });
      clearTimeout(keyTimer.current);
      keyTimer.current = setTimeout(commit, KEY_DELAY);
    },
    onBlur: () => {
      if (current.current?.issue === issue && current.current.via === "keys") commit();
    },
  });

  return { move, cardProps };
}

/** Where a moved card lands: the queue after the move, the place it was dropped at, and the flow in that order. */
export type CardPlace = {
  issue: number;
  /** The 0-based place in the queue the card was dropped at, before pinned tasks went back to their places. */
  index: number;
  /** The new queue: the card at its place and each pinned task back at its place number. */
  queue: number[];
  /** The flow in the new order, the card pinned. */
  flow: Flow;
  /** What the tooltip says while the card moves. */
  tip: { title: string; line: string; warning?: string | undefined };
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The Flow's input with the queue in a new order and the moved card pinned. Under Priority order the drop asks
 * to switch to Project order first, so the preview shows the order as Project order would start it.
 */
export function movedInput(input: FlowInput, queue: readonly number[], issue: number): FlowInput {
  const base = input.order === "priority" ? { ...input, order: "project" as const } : input;
  return { ...reorderFlow(base, queue), pins: new Set([...input.pins, issue]) };
}

/** The queue with the card dropped at `index` and every other pinned task back at its place number. */
function queueAt(flow: Flow, pins: ReadonlySet<number>, issue: number, index: number): number[] {
  const others = new Set([...pins].filter((n) => n !== issue));
  return keepPins(flow.queue, moveTo(flow.queue, issue, index), others);
}

/** The card's place: the queue, the flow in it, and the tooltip's "Next 1, before #58. Lands in slot 3. 3 cards move." */
function placeAt(input: FlowInput, flow: Flow, issue: number, index: number, via: CardMove["via"]): CardPlace {
  const queue = queueAt(flow, input.pins, issue, index);
  const moved = layoutFlow(movedInput(input, queue, issue));
  const at = moved.ready.indexOf(issue);
  const before = moved.ready[at + 1];
  const after = moved.ready[at - 1];
  const title = `Next ${at + 1}${before !== undefined ? `, before #${before}` : after !== undefined ? `, after #${after}` : ""}`;
  const lanes = new Map(flow.cards.map((c) => [c.issue, c.lane]));
  const card = moved.cards.find((c) => c.issue === issue);
  const changed = moved.cards.filter((c) => c.issue !== issue && lanes.has(c.issue) && lanes.get(c.issue) !== c.lane).length;
  const line = [card && `Lands in slot ${card.lane}.`, changed > 0 && `${plural(changed, "card")} ${changed === 1 ? "moves" : "move"}.`, via === "keys" && "Saves when you stop pressing keys."].filter(Boolean).join(" ");
  const waits = moved.breaks.find((b) => b.issue === issue)?.waitsFor;
  return { issue, index, queue, flow: moved, tip: { title, line, warning: waits && `Waits for ${waits.map((n) => `#${n}`).join(", ")}` } };
}

/**
 * Where a move puts a Ready card. Alt and the arrows move it a place at a time. A drag puts it at the place, on
 * the side it moves towards, where the card would start nearest to where the pointer left it; among places where
 * it starts at the same time, the one furthest along wins, so a drag to the front makes it Next 1. Only the Ready
 * part of the queue takes a dragged card; Shaping tasks follow it.
 */
export function placeMove(input: FlowInput, flow: Flow, move: CardMove, unit: number): CardPlace | undefined {
  const at = flow.ready.indexOf(move.issue);
  const card = flow.cards.find((c) => c.issue === move.issue);
  if (at === -1 || !card) return undefined;
  const last = flow.ready.length - 1;
  if (move.via === "keys") return placeAt(input, flow, move.issue, Math.max(0, Math.min(last, at + move.steps)), "keys");
  const target = card.start + move.dx / unit;
  const indexes = move.dx < 0 ? Array.from({ length: at + 1 }, (_, i) => i) : Array.from({ length: last - at + 1 }, (_, i) => last - i);
  let best = { index: at, distance: Infinity };
  for (const index of indexes) {
    const start = layoutFlow(movedInput(input, queueAt(flow, input.pins, move.issue, index), move.issue)).cards.find((c) => c.issue === move.issue)?.start;
    if (start === undefined) continue;
    const distance = Math.abs(start - target);
    if (distance < best.distance) best = { index, distance };
  }
  return placeAt(input, flow, move.issue, best.index, "pointer");
}
