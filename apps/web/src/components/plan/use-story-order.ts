import { useCallback, useSyncExternalStore } from "react";

const KEY = "handoff.flow.storyOrder";
const CHANGED = "handoff:flow-story-order";
/** The last choice in this page, for a browser that blocks storage. */
let memory = true;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return memory;
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

/** Whether the Flow shows each story's then arrows in this browser, from the Legend's switch; on until switched off. */
export function useStoryOrder() {
  const shown = useSyncExternalStore(subscribe, read, () => true);
  const setShown = useCallback((next: boolean) => {
    memory = next;
    try {
      if (next) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, "off");
    } catch {
      // Storage blocked: the switch holds until the page reloads.
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [shown, setShown] as const;
}
