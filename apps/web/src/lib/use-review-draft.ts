"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

/** `choices` holds what the person picked for a code reviewer's findings, by their place in the review. */
type Draft<T> = { comments: T[]; note: string; choices: Record<number, string> };

const keyOf = (questionId: string) => `handoff:review-draft:${questionId}`;

// Where storage is missing or blocked, drafts live in memory for this page's life instead.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function parse<T>(raw: string | null): Draft<T> {
  try {
    const draft = raw ? (JSON.parse(raw) as Partial<Draft<T>>) : {};
    const choices = draft.choices && typeof draft.choices === "object" && !Array.isArray(draft.choices) ? draft.choices : {};
    return { comments: Array.isArray(draft.comments) ? draft.comments : [], note: typeof draft.note === "string" ? draft.note : "", choices };
  } catch {
    return { comments: [], note: "", choices: {} };
  }
}

const save = <T,>(key: string, draft: Draft<T>) => store(key, draft.comments.length === 0 && !draft.note && Object.keys(draft.choices).length === 0 ? null : JSON.stringify(draft));

/**
 * A review's unsent comments, overall comment and choices for its findings, kept in this browser until
 * the review is sent, so leaving the page loses nothing. The server renders an empty draft; the browser's copy follows.
 */
export function useReviewDraft<T>(questionId: string, enabled = true) {
  const key = keyOf(questionId);
  const raw = useSyncExternalStore(
    subscribe,
    () => (enabled ? read(key) : null),
    () => null,
  );
  const draft = useMemo(() => parse<T>(raw), [raw]);
  const sent = useRef<string | null>(null);

  const setComments = useCallback(
    (update: T[] | ((list: T[]) => T[])) => {
      const current = parse<T>(read(key));
      save(key, { ...current, comments: typeof update === "function" ? update(current.comments) : update });
    },
    [key],
  );
  const setNote = useCallback((note: string) => save(key, { ...parse<T>(read(key)), note }), [key]);
  const setChoice = useCallback(
    (index: number, choice: string) => {
      const current = parse<T>(read(key));
      save(key, { ...current, choices: { ...current.choices, [index]: choice } });
    },
    [key],
  );
  // A sent review redirects to the run, so the draft goes first and comes back if the send fails.
  const onSending = () => {
    sent.current = read(key);
    store(key, null);
  };
  const onFailed = () => store(key, sent.current);

  return { comments: draft.comments, setComments, note: draft.note, setNote, choices: draft.choices, setChoice, onSending, onFailed };
}
