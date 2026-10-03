import { useSyncExternalStore } from "react";

/** Whether the browser runs on a Mac, an iPhone or an iPad, where the shortcut key is Command. */
export function isMacPlatform(nav: { platform: string; userAgent: string }): boolean {
  return /mac|iphone|ipad|ipod/i.test(nav.platform || nav.userAgent);
}

/** The modifier as shortcut labels show it: ⌘ on a Mac, Ctrl elsewhere. */
export const modKeyLabel = (mac: boolean) => (mac ? "⌘" : "Ctrl");

const noSubscribe = () => () => {};

/**
 * Whether this browser is on a Mac. The server and the first render after it say true, as the labels
 * read before this helper; the browser's own answer follows right after hydration.
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => isMacPlatform(navigator),
    () => true,
  );
}

/** A shortcut as tooltips write it: ⌘B on a Mac, Ctrl+B elsewhere. */
export const shortcutText = (mac: boolean, key: string) => (mac ? `⌘${key}` : `Ctrl+${key}`);

/** The modifier of this browser's shortcuts as a label: ⌘ on a Mac, Ctrl elsewhere. */
export const useModKey = () => modKeyLabel(useIsMac());
