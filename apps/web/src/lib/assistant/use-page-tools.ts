"use client";

import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { useOptionalPageRegistry } from "@/components/assistant/assistant-provider";
import type { PageHandlers, PageKind } from "./page-tools";
import type { OpenPage, PageToolHandler } from "./run-page-tool";

/**
 * Offers the open page's tools to the assistant while the page is mounted: `handlers` act in the page,
 * `describe` returns its state for where_am_i. The registration changes only when the kind or the set
 * of bound tools does; the handlers and describe always see the page's latest state. Outside an
 * AssistantProvider it does nothing. The kind alone decides the handlers' types: NoInfer keeps
 * TypeScript from inferring it from the handlers too, which loses their arguments' types.
 *
 * Calls run one at a time, and each waits until the page has rendered what the one before changed: a
 * browser agent can send the next call before React renders, and its handler would otherwise act on
 * the state before the last call.
 */
export function usePageTools<K extends PageKind>(kind: K, handlers: NoInfer<PageHandlers<K>>, describe: () => unknown) {
  const registerPage = useOptionalPageRegistry();
  const latest = useRef({ handlers: handlers as Partial<Record<string, PageToolHandler>>, describe });
  // Calls waiting for the next render, and the render a call asks for so that one always comes.
  const rendered = useRef<(() => void)[]>([]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const queue = useRef<Promise<unknown> | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = { handlers: handlers as Partial<Record<string, PageToolHandler>>, describe };
    for (const resolve of rendered.current.splice(0)) resolve();
  });
  // A page that leaves releases the calls waiting on it.
  useEffect(() => () => void rendered.current.splice(0).forEach((resolve) => resolve()), []);
  const bound = Object.entries(handlers as Record<string, unknown>)
    .filter(([, handler]) => handler)
    .map(([name]) => name)
    .sort()
    .join(" ");

  useEffect(() => {
    if (!registerPage) return;
    const run = async (name: string, args: never) => {
      const handler = latest.current.handlers[name];
      if (!handler) throw new Error(`${name} is not available on this page now.`);
      const next = new Promise<void>((resolve) => rendered.current.push(resolve));
      try {
        return await handler(args);
      } finally {
        rerender();
        await next;
      }
    };
    const call = (name: string) => (args: never) => {
      const result = (queue.current ?? Promise.resolve()).then(() => run(name, args));
      queue.current = result.catch(() => undefined);
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
