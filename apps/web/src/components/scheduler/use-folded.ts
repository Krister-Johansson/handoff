import { useCallback, useSyncExternalStore } from "react";

const CHANGED = "handoff:scheduler-folded";
const keyOf = (projectId: string) => `handoff.scheduler.folded.${projectId}`;

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Whether the scheduler card of one project is folded in this browser; it starts open. */
export function useFolded(projectId: string) {
  const key = keyOf(projectId);
  const folded = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const setFolded = useCallback(
    (next: boolean) => {
      try {
        if (next) localStorage.setItem(key, "1");
        else localStorage.removeItem(key);
      } catch {
        // Storage blocked: the card opens again on the next visit.
      }
      window.dispatchEvent(new Event(CHANGED));
    },
    [key],
  );
  return [folded, setFolded] as const;
}
