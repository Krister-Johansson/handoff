"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { MoveDraft } from "@/lib/plan/move";

/** A move in progress: whose bar, what the gesture or the keys did so far, and which of them did it. */
export type BarDrag = MoveDraft & { issue: number; via: "pointer" | "keys" };

/** A bar that can move: how wide a day and an hour are under it, and its duration in hours when it has one. */
export type DragBar = { issue: number; dayWidth: number; hourWidth: number; hours: number | undefined };

/** Pixels a pointer moves before a press becomes a drag; less is a click. */
const SLOP = 3;
/** How long after the last arrow key the keyboard's move is saved. */
export const KEY_DELAY = 800;

type Gesture = DragBar & { edge: "move" | "end"; x0: number; moved: boolean };

/**
 * Dragging and keyboard moves of timeline bars, with no drag library: pointer events on the bars, snapped to
 * days, or to hours on a bar's end. A drop, the last arrow key after a pause or leaving the bar hands the move
 * to `onDrop`; Escape puts the bar back. An unscheduled task's grip drags the task onto the chart through
 * `dayAt`, which names the day under the pointer or undefined off the chart.
 */
export function useBarDrag({ onDrop, onSize }: { onDrop: (drag: BarDrag) => void; onSize: (issue: number) => void }) {
  const [drag, setDragState] = useState<BarDrag>();
  const current = useRef<BarDrag | undefined>(undefined);
  const gesture = useRef<Gesture | null>(null);
  const clickAfterDrag = useRef(false);
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stopPlacing = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      clearTimeout(keyTimer.current);
      stopPlacing.current?.();
    },
    [],
  );

  const setDrag = (next: BarDrag | undefined) => {
    current.current = next;
    setDragState(next);
  };
  const cancel = () => {
    clearTimeout(keyTimer.current);
    gesture.current = null;
    stopPlacing.current?.();
    setDrag(undefined);
  };
  const commit = () => {
    clearTimeout(keyTimer.current);
    const done = current.current;
    setDrag(undefined);
    if (done && (done.days !== 0 || done.estimate !== undefined || done.place)) onDrop(done);
  };

  const pointerDown = (bar: DragBar, edge: Gesture["edge"]) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (edge === "end") e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gesture.current = { ...bar, edge, x0: e.clientX, moved: false };
  };

  /** What a bar that moves spreads on its element. */
  const barProps = (bar: DragBar) => ({
    draggable: false,
    onPointerDown: pointerDown(bar, "move"),
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.issue !== bar.issue) return;
      const dx = e.clientX - g.x0;
      if (!g.moved && Math.abs(dx) < SLOP) return;
      g.moved = true;
      setDrag(
        g.edge === "move"
          ? { issue: g.issue, days: Math.round(dx / g.dayWidth), via: "pointer" }
          : { issue: g.issue, days: 0, estimate: Math.max(1, Math.round(g.hours! + dx / g.hourWidth)), via: "pointer" },
      );
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
      if (e.key === "Escape" && current.current?.issue === bar.issue) {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        onSize(bar.issue);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const step = e.key === "ArrowLeft" ? -1 : 1;
      if (e.shiftKey && bar.hours === undefined) return;
      e.preventDefault();
      const was = current.current?.issue === bar.issue && current.current.via === "keys" ? current.current : { issue: bar.issue, days: 0, via: "keys" as const };
      setDrag(
        e.shiftKey
          ? { ...was, estimate: Math.max(1, (was.estimate ?? Math.round(bar.hours!)) + step) }
          : { ...was, days: was.days + step },
      );
      clearTimeout(keyTimer.current);
      keyTimer.current = setTimeout(commit, KEY_DELAY);
    },
    onBlur: () => {
      if (current.current?.issue === bar.issue && current.current.via === "keys") commit();
    },
  });

  /** What the end handle of a bar with a duration spreads: dragging it sets a manual estimate in whole hours. */
  const endProps = (bar: DragBar) => ({ onPointerDown: pointerDown(bar, "end") });

  /** What an unscheduled task's grip spreads: a drag from it places the task on the day under the pointer. */
  const gripProps = (issue: number, dayAt: (x: number, y: number) => string | undefined) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      stopPlacing.current?.();
      setDrag({ issue, days: 0, place: undefined, via: "pointer" });
      const move = (ev: globalThis.PointerEvent) => setDrag({ issue, days: 0, place: dayAt(ev.clientX, ev.clientY), via: "pointer" });
      const up = () => {
        stopPlacing.current?.();
        if (current.current?.place) commit();
        else setDrag(undefined);
      };
      const key = (ev: globalThis.KeyboardEvent) => ev.key === "Escape" && cancel();
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("keydown", key);
      stopPlacing.current = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("keydown", key);
        stopPlacing.current = null;
      };
    },
  });

  return { drag, barProps, endProps, gripProps };
}
