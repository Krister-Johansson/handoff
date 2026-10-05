import { useCallback, useSyncExternalStore } from "react";

const KEY = "handoff.review-comments-folded";
const CHANGED = "handoff:review-comments-folded";
// Where storage is blocked, the folds live in memory until the page reloads.
const memory = new Map<string, boolean>();

function readAll(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, boolean>) : {};
  } catch {
    return Object.fromEntries(memory);
  }
}

/** Whether this browser folded the run's Review comments card, or undefined when nobody chose. */
export function readFold(runId: string): boolean | undefined {
  const folded = readAll()[runId];
  return typeof folded === "boolean" ? folded : undefined;
}

export function writeFold(runId: string, folded: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [runId]: folded }));
  } catch {
    memory.set(runId, folded);
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The fold of a run's Review comments card as this browser keeps it, with `fallback` until someone folds or
 * opens it. The server renders the fallback.
 */
export function useReviewFold(runId: string, fallback: boolean): [boolean, (folded: boolean) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => readFold(runId),
    () => undefined,
  );
  const set = useCallback((folded: boolean) => writeFold(runId, folded), [runId]);
  return [stored ?? fallback, set];
}
