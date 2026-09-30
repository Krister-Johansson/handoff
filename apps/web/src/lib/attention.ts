/** Something to tell a person about. A finished run is news, but needs no action, unlike the other kinds. */
export type AttentionItem = { id: string; kind: "question" | "failed" | "review" | "finished"; title: string; body: string; href: string };

/** Whether an item waits on a person: everything except a run that finished. */
export const needsAction = (item: AttentionItem) => item.kind !== "finished";
export type NotifyPrefs = { desktop: boolean; sound: boolean };

const PREFS_KEY = "handoff.notify";
const SEEN_KEY = "handoff.attention.seen";

const read = <T>(key: string): T | undefined => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked; the setting lasts for this page only.
  }
};

export const readPrefs = (): NotifyPrefs => ({ desktop: false, sound: true, ...read<Partial<NotifyPrefs>>(PREFS_KEY) });
export const writePrefs = (prefs: NotifyPrefs) => write(PREFS_KEY, prefs);

/** Ids notified before, in this browser; undefined the first time, when nothing should be notified. */
export const readSeen = (): Set<string> | undefined => {
  const ids = read<string[]>(SEEN_KEY);
  return ids ? new Set(ids) : undefined;
};
/** Keeps only the ids still open, so the list does not grow forever. */
export const writeSeen = (items: AttentionItem[]) => write(SEEN_KEY, items.map((i) => i.id));

/** The page title with the number of things waiting, as "(2) handoff". */
export const titleWithCount = (title: string, count: number) => `${count > 0 ? `(${count}) ` : ""}${title.replace(/^\(\d+\) /, "")}`;
