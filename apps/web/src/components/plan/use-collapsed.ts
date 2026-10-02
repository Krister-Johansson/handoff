import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

const CHANGED = "handoff:plan-collapsed";
const keyOf = (projectId: string) => `handoff.plan.collapsed.${projectId}`;

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
}

function write(key: string, rows: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...rows]));
  } catch {
    // Storage blocked: the rows stay open after a reload.
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

function parse(raw: string): Set<string> {
  try {
    const rows: unknown = JSON.parse(raw);
    return new Set(Array.isArray(rows) ? rows.filter((r): r is string => typeof r === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * The tree rows collapsed in this browser for one project's plan; every row is open until collapsed. The
 * tree and the timeline share it, and the toolbar's Expand all and Collapse all write it.
 */
export function useCollapsed(projectId: string) {
  const key = keyOf(projectId);
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => "[]",
  );
  const rows = useMemo(() => parse(raw), [raw]);
  const toggle = useCallback(
    (row: string, open?: boolean) => {
      const next = new Set(rows);
      if (open ?? next.has(row)) next.delete(row);
      else next.add(row);
      write(key, next);
    },
    [key, rows],
  );
  const collapseAll = useCallback((more: string[]) => write(key, new Set([...rows, ...more])), [key, rows]);
  /** Opens these rows, or every row when none are named. */
  const expand = useCallback(
    (open?: string[]) => {
      const opened = new Set(open);
      write(key, open ? new Set([...rows].filter((r) => !opened.has(r))) : new Set());
    },
    [key, rows],
  );
  return { has: (row: string) => rows.has(row), toggle, collapseAll, expand };
}

/**
 * Which rows are open: the collapse store's, or during a search the rows the search opens. A row opened
 * or closed during a search stays that way until the search changes, and is never written to the store.
 */
export function useRowsOpen(projectId: string, searchOpen: Set<string> | undefined) {
  const collapsed = useCollapsed(projectId);
  const [local, setLocal] = useState<{ for: Set<string>; rows: Map<string, boolean> }>();
  const overrides = searchOpen && local?.for === searchOpen ? local.rows : undefined;
  const isOpen = (key: string) => (searchOpen ? (overrides?.get(key) ?? searchOpen.has(key)) : !collapsed.has(key));
  const toggle = (key: string, open?: boolean) => {
    if (!searchOpen) return collapsed.toggle(key, open);
    setLocal({ for: searchOpen, rows: new Map(overrides).set(key, open ?? !isOpen(key)) });
  };
  return { isOpen, toggle, collapsed };
}
