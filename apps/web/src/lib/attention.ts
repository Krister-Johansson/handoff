/** Something to tell a person about. A finished run is news, but needs no action, unlike the other kinds. */
export type AttentionItem = { id: string; kind: "question" | "failed" | "review" | "finished"; title: string; body: string; href: string };

export type NotifyPrefs = { desktop: boolean; sound: boolean };

const PREFS_KEY = "handoff.notify";

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


/** The page title with a count in front, as "(2) handoff". */
export const titleWithCount = (title: string, count: number) => `${count > 0 ? `(${count}) ` : ""}${title.replace(/^\(\d+\) /, "")}`;
