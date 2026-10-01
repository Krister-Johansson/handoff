"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

const subscribe = () => () => {};

/**
 * The React Flow colour mode for the page's theme, so canvases follow the dark and light setting.
 * The server cannot know the theme, so it is light until the page has hydrated.
 */
export function useFlowColorMode(): "light" | "dark" {
  const { resolvedTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return hydrated && resolvedTheme === "dark" ? "dark" : "light";
}
