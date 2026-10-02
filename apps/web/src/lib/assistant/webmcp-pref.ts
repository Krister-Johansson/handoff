import { useSyncExternalStore } from "react";

const KEY = "handoff.webmcp";
const CHANGED = "handoff:webmcp";

/** Whether this browser exposes the dashboard's tools through WebMCP: on unless switched off here. */
export function readWebMcpEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeWebMcpEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
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

/** The WebMCP switch of this browser, kept current when it changes here or in another tab. */
export function useWebMcpEnabled(): boolean {
  return useSyncExternalStore(subscribe, readWebMcpEnabled, () => true);
}

const noSubscribe = () => () => {};

/** Whether this browser has WebMCP at all (`document.modelContext`). */
export function useHasWebMcp(): boolean {
  return useSyncExternalStore(noSubscribe, () => "modelContext" in document, () => false);
}
