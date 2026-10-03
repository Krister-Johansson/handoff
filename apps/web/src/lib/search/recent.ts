import type { SearchHit, SearchItem } from "./results";

const RECENT_KEY = "handoff.search.recent";
/** How many items Recent keeps. */
export const RECENT_SIZE = 4;

const KINDS = new Set(["task", "run", "page", "chat"]);
const isRecent = (value: unknown): value is SearchItem => {
  const item = value as { kind?: unknown; key?: unknown } | null;
  return !!item && typeof item.key === "string" && typeof item.kind === "string" && KINDS.has(item.kind) && item.kind in item;
};

/** The items opened from search last, newest first, as this browser keeps them; none when it keeps nothing. */
export function readRecent(): SearchItem[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isRecent).slice(0, RECENT_SIZE) : [];
  } catch {
    return [];
  }
}

/** Puts an opened result first in Recent and keeps the last 4; a browser that keeps nothing keeps nothing. */
export function rememberRecent(hit: SearchHit | SearchItem) {
  const item = Object.fromEntries(Object.entries(hit).filter(([key]) => key !== "match")) as SearchItem;
  const next = [item, ...readRecent().filter((r) => r.key !== hit.key)].slice(0, RECENT_SIZE);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private windows and blocked storage keep no Recent.
  }
}
