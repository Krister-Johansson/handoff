"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useOptionalPageRegistry } from "@/components/assistant/assistant-provider";
import type { PageHandlers, PageKind } from "./page-tools";
import type { OpenPage, PageToolHandler } from "./run-page-tool";

/**
 * Offers the open page's tools to the assistant while the page is mounted: `handlers` act in the page,
 * `describe` returns its state for where_am_i. The registration changes only when the kind or the set
 * of bound tools does; the handlers and describe always see the page's latest state. Outside an
 * AssistantProvider it does nothing. The kind alone decides the handlers' types: NoInfer keeps
 * TypeScript from inferring it from the handlers too, which loses their arguments' types.
 */
export function usePageTools<K extends PageKind>(kind: K, handlers: NoInfer<PageHandlers<K>>, describe: () => unknown) {
  const registerPage = useOptionalPageRegistry();
  const latest = useRef({ handlers: handlers as Partial<Record<string, PageToolHandler>>, describe });
  useLayoutEffect(() => {
    latest.current = { handlers: handlers as Partial<Record<string, PageToolHandler>>, describe };
  });
  const bound = Object.entries(handlers as Record<string, unknown>)
    .filter(([, handler]) => handler)
    .map(([name]) => name)
    .sort()
    .join(" ");

  useEffect(() => {
    if (!registerPage) return;
    const call = (name: string) => (args: never) => {
      const handler = latest.current.handlers[name];
      if (!handler) throw new Error(`${name} is not available on this page now.`);
      // A browser agent can send the next call before React renders; rendering the changes at once
      // means the next call's handler sees them.
      let result: ReturnType<PageToolHandler> = "";
      flushSync(() => {
        result = handler(args);
      });
      return result;
    };
    const page: OpenPage = {
      kind,
      handlers: Object.fromEntries(bound.split(" ").filter(Boolean).map((name) => [name, call(name)])),
      describe: () => latest.current.describe(),
    };
    return registerPage(page);
  }, [registerPage, kind, bound]);
}
