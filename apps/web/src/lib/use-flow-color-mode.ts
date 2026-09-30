"use client";

import { useTheme } from "next-themes";

/** The React Flow colour mode for the page's theme, so canvases follow the dark and light setting. */
export function useFlowColorMode(): "light" | "dark" {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? "dark" : "light";
}
