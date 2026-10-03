"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { PendingRequest } from "@/lib/assistant/port";

/** How long an approval card for a call made in the page waits for the person before the call is denied. */
const APPROVAL_TIMEOUT_MS = 5 * 60_000;

type Answer = { approved: boolean; note?: string };
type Call = { name: string; title: string; summary: string; args: unknown };

/**
 * Approval cards for calls made in the page rather than by a turn: a browser agent's through WebMCP, and an MCP
 * Apps view's (`viewCallId`, the tool call whose card the view is). `ask` resolves with the person's answer; no
 * answer in time, or `signal` aborting (the view's card going), denies it. `answer` settles a card of this page
 * and says whether it was one.
 */
export function usePageApprovals() {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const pending = useRef(new Map<string, (answer: Answer) => void>());

  const ask = useCallback((call: Call, from: { viewCallId?: string | undefined; signal?: AbortSignal | undefined } = {}) => {
    const requestId = `${from.viewCallId ? "view" : "agent"}-${crypto.randomUUID()}`;
    return new Promise<Answer>((resolve) => {
      const settle = (answer: Answer) => {
        clearTimeout(timer);
        from.signal?.removeEventListener("abort", onAbort);
        pending.current.delete(requestId);
        setRequests((list) => list.filter((r) => r.requestId !== requestId));
        resolve(answer);
      };
      const onAbort = () => settle({ approved: false, note: "The card that asked is gone." });
      const timer = setTimeout(() => settle({ approved: false, note: "No one approved this in time." }), APPROVAL_TIMEOUT_MS);
      from.signal?.addEventListener("abort", onAbort);
      pending.current.set(requestId, settle);
      const expiresAt = new Date(Date.now() + APPROVAL_TIMEOUT_MS).toISOString();
      setRequests((list) => [...list, { requestId, ...call, status: "open", expiresAt, ...(from.viewCallId ? { viewCallId: from.viewCallId } : {}) }]);
      if (from.signal?.aborted) onAbort();
    });
  }, []);

  const answer = useCallback((requestId: string, decision: Answer) => {
    const settle = pending.current.get(requestId);
    settle?.(decision);
    return settle !== undefined;
  }, []);

  const agentRequests = useMemo(() => requests.filter((r) => !r.viewCallId), [requests]);
  const viewRequests = useMemo(() => requests.filter((r) => r.viewCallId), [requests]);
  return { agentRequests, viewRequests, ask, answer };
}
