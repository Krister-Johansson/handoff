/// <reference types="webmcp-types" />
"use client";

import { useEffect, useState } from "react";

/**
 * Whether a browser agent is filling the declarative WebMCP form `toolName` right now: true from its
 * toolactivated event until the form is submitted or the agent cancels.
 */
export function useToolFormActive(toolName: string): [boolean, () => void] {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const context = document.modelContext;
    if (!context) return;
    const controller = new AbortController();
    const mine = (e: Event) => (e as Event & { toolName?: string }).toolName === toolName;
    context.addEventListener("toolactivated", (e) => mine(e) && setActive(true), { signal: controller.signal });
    context.addEventListener("toolcancel", (e) => mine(e) && setActive(false), { signal: controller.signal });
    return () => controller.abort();
  }, [toolName]);
  return [active, () => setActive(false)];
}
