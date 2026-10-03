"use client";

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ChatMessage, PendingRequest, ReplyUpdate } from "@/lib/assistant/port";
import type { AssistantTransport, TurnStreamEvent } from "@/lib/assistant/transport";

type Reply = Extract<ChatMessage, { role: "assistant" }>;
type UiCall = Extract<TurnStreamEvent, { type: "ui_call" }>;

/** An empty reply that fills as its turn streams. */
export const streamingReply = (id: string): ChatMessage => ({ id, role: "assistant", text: "", calls: [], requests: [], status: "streaming" });

const requestOf = (event: Extract<TurnStreamEvent, { type: "confirm" }>): PendingRequest => ({
  requestId: event.requestId,
  toolUseId: event.toolUseId,
  name: event.name,
  title: event.title,
  summary: event.summary,
  args: event.args,
  status: "open",
  ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
});

/** Applies one event of the running turn to the reply it belongs to. */
export function applyEvent(message: Reply, event: TurnStreamEvent): Reply {
  switch (event.type) {
    case "text":
      return { ...message, text: message.text + event.text };
    case "tool_call":
      return { ...message, calls: [...message.calls, { id: event.id, name: event.name, title: event.title, summary: event.summary, status: "running" }] };
    case "tool_result": {
      const denied = message.requests.some((r) => r.toolUseId === event.id && r.status === "denied");
      return {
        ...message,
        calls: message.calls.map((c) => (c.id === event.id ? { ...c, status: denied ? "denied" : event.isError ? "failed" : "done", result: event.result } : c)),
      };
    }
    case "confirm":
      return { ...message, requests: [...message.requests, requestOf(event)] };
    case "confirmed":
      return {
        ...message,
        requests: message.requests.map((r) => (r.requestId === event.requestId ? { ...r, status: event.approved ? "approved" : "denied", ...(event.note ? { note: event.note } : {}) } : r)),
      };
    case "done":
      return { ...message, text: event.text || message.text, status: "done" };
    case "interrupted":
      return { ...message, status: "stopped" };
    case "error":
      return { ...message, status: "error", error: event.message };
    default:
      return message;
  }
}

/**
 * The stream of the turn the panel follows: the turn it started, or the running turn of a chat it
 * opened. One stream at a time; letting go of it (`release`) leaves the turn running on the server and
 * its reply is stored. `runUi` runs a UI tool call of a turn this page started.
 */
export function useTurnStream({
  transport,
  setMessages,
  runUi,
}: {
  transport: AssistantTransport;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  runUi: (call: UiCall) => Promise<{ text: string; isError: boolean; note?: string }>;
}) {
  const [streaming, setStreaming] = useState(false);
  const turnId = useRef<string | undefined>(undefined);
  const current = useRef<AbortController | undefined>(undefined);
  const replyListeners = useRef(new Set<(reply: ReplyUpdate) => void>());
  const requestListeners = useRef(new Set<(request: PendingRequest) => void>());

  const release = useCallback(() => {
    current.current?.abort();
    current.current = undefined;
    turnId.current = undefined;
    setStreaming(false);
  }, []);

  /**
   * Follows a turn's stream into the reply `replyId`. `live` is the stream of a turn this page started:
   * its UI tool calls run here. A followed turn's earlier UI calls are not run again.
   */
  const follow = useCallback(
    async (replyId: string, start: (onEvent: (event: TurnStreamEvent) => void, signal: AbortSignal) => Promise<void>, { live, turn }: { live: boolean; turn?: string }) => {
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      turnId.current = turn;
      setStreaming(true);
      let text = "";
      const update = (change: (m: Reply) => ChatMessage) => setMessages((list) => list.map((m) => (m.id === replyId && m.role === "assistant" ? change(m) : m)));
      const onEvent = (event: TurnStreamEvent) => {
        if (controller.signal.aborted) return;
        if (event.type === "turn") {
          turnId.current = event.turnId;
          return;
        }
        if (event.type === "text") {
          text += event.text;
          for (const listener of replyListeners.current) listener({ id: replyId, text, done: false });
        }
        if (event.type === "done") for (const listener of replyListeners.current) listener({ id: replyId, text: event.text || text, done: true });
        update((m) => applyEvent(m, event));
        if (event.type === "confirm") for (const listener of requestListeners.current) listener(requestOf(event));
        if (event.type === "ui_call" && live) {
          const turn = turnId.current;
          void runUi(event).then(async (outcome) => {
            if (outcome.note) {
              const note = { id: event.requestId, text: outcome.note };
              update((m) => ({ ...m, notes: [...(m.notes ?? []), note] }));
            }
            if (turn) await transport.uiReply(turn, event.requestId, { text: outcome.text, isError: outcome.isError });
          });
        }
      };
      try {
        await start(onEvent, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) update((m) => ({ ...m, status: "error", error: (error as Error).message }));
      } finally {
        if (current.current === controller) {
          current.current = undefined;
          turnId.current = undefined;
          setStreaming(false);
        }
      }
    },
    [transport, setMessages, runUi],
  );

  const onReply = useCallback((cb: (reply: ReplyUpdate) => void) => {
    replyListeners.current.add(cb);
    return () => void replyListeners.current.delete(cb);
  }, []);
  const onRequest = useCallback((cb: (request: PendingRequest) => void) => {
    requestListeners.current.add(cb);
    return () => void requestListeners.current.delete(cb);
  }, []);

  return { streaming, turnId, follow, release, onReply, onRequest };
}
