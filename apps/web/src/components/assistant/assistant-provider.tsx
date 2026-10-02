"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { toolSpec } from "@/lib/assistant/catalog";
import { runUiTool } from "@/lib/assistant/run-ui-tool";
import type { AssistantPort, ChatMessage, PendingRequest, ReplyUpdate, ToolCallView } from "@/lib/assistant/port";
import { httpTransport, type AssistantTransport, type ConversationSummary, type StoredMessage, type TurnStreamEvent } from "@/lib/assistant/transport";

/** What the panel needs on top of the port: the messages, the conversations and switching between them. */
type PanelState = {
  messages: ChatMessage[];
  conversationId: string | undefined;
  conversations: ConversationSummary[] | undefined;
  loadConversations(): Promise<void>;
  openConversation(id: string): Promise<void>;
  newConversation(): void;
};

const PortContext = createContext<AssistantPort | undefined>(undefined);
const PanelContext = createContext<PanelState | undefined>(undefined);

/** The assistant, for any part of the dashboard: the panel, the header button, and later voice. */
export function useAssistant(): AssistantPort {
  const port = useContext(PortContext);
  if (!port) throw new Error("useAssistant needs an AssistantProvider.");
  return port;
}

export function useAssistantPanel(): PanelState {
  const panel = useContext(PanelContext);
  if (!panel) throw new Error("useAssistantPanel needs an AssistantProvider.");
  return panel;
}

/** A stored tool call as the panel shows it, with its catalog title and summary. */
function callView(call: { id: string; name: string; args: unknown; result?: string; isError?: boolean; approval?: { approved: boolean } }): ToolCallView {
  let title = call.name;
  let summary = call.name;
  try {
    const spec = toolSpec(call.name);
    const parsed = spec.input.safeParse(call.args);
    title = spec.title;
    summary = parsed.success ? spec.summarize(parsed.data) : spec.title;
  } catch {
    // A tool the catalog no longer has keeps its name.
  }
  const status = call.approval?.approved === false ? "denied" : call.isError ? "failed" : "done";
  return { id: call.id, name: call.name, title, summary, status, ...(call.result !== undefined ? { result: call.result } : {}) };
}

/** A stored message as the panel shows it. */
function messageView(stored: StoredMessage): ChatMessage {
  const content = stored.content;
  if (stored.role === "user") return { id: stored.id, role: "user", text: content.text };
  const reply = content as Extract<StoredMessage["content"], { calls: unknown }>;
  const status = reply.outcome === "done" ? "done" : reply.outcome === "interrupted" ? "stopped" : "error";
  return { id: stored.id, role: "assistant", text: reply.text, calls: reply.calls.map(callView), requests: [], status, ...(reply.error ? { error: reply.error } : {}) };
}

/** Applies one event of the running turn to the reply it belongs to. */
function applyEvent(message: Extract<ChatMessage, { role: "assistant" }>, event: TurnStreamEvent): Extract<ChatMessage, { role: "assistant" }> {
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
      return {
        ...message,
        requests: [...message.requests, { requestId: event.requestId, toolUseId: event.toolUseId, name: event.name, title: event.title, summary: event.summary, args: event.args, status: "open" }],
      };
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
 * Owns the assistant for the whole dashboard: the open conversation, its messages as they stream, the
 * approval cards, and the panel's open state. It lives in the root layout, so a navigation the
 * assistant makes leaves the conversation on screen. Mod+J opens the panel from anywhere.
 */
export function AssistantProvider({ children, available, transport = httpTransport }: { children: ReactNode; available: boolean; transport?: AssistantTransport }) {
  const [isOpen, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [conversations, setConversations] = useState<ConversationSummary[]>();
  const [streaming, setStreaming] = useState(false);
  const router = useRouter();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const turnId = useRef<string | undefined>(undefined);
  const replyListeners = useRef(new Set<(reply: ReplyUpdate) => void>());
  const requestListeners = useRef(new Set<(request: PendingRequest) => void>());

  const focusComposer = useCallback(() => setTimeout(() => composerRef.current?.focus(), 0), []);
  const open = useCallback(() => {
    setOpen(true);
    focusComposer();
  }, [focusComposer]);
  const close = useCallback(() => setOpen(false), []);

  // Mod+J toggles the panel; the listener is added once and reads the current state when it fires.
  const toggle = useEffectEvent(() => (isOpen ? close() : open()));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = useCallback(
    async (text: string, opts?: { source?: "voice" | "typed" }) => {
      const message = text.trim();
      if (!message || streaming || !available) return;
      setStreaming(true);
      const replyId = `reply-${Date.now()}`;
      setMessages((list) => [...list, { id: `user-${Date.now()}`, role: "user", text: message }, { id: replyId, role: "assistant", text: "", calls: [], requests: [], status: "streaming" }]);
      try {
        const id = conversationId ?? (await transport.create(message)).id;
        if (!conversationId) setConversationId(id);
        let text = "";
        await transport.turn(id, message, opts?.source ?? "typed", (event) => {
          if (event.type === "turn") {
            turnId.current = event.turnId;
            return;
          }
          if (event.type === "text") {
            text += event.text;
            for (const listener of replyListeners.current) listener({ id: replyId, text, done: false });
          }
          if (event.type === "done") for (const listener of replyListeners.current) listener({ id: replyId, text: event.text || text, done: true });
          setMessages((list) => list.map((m) => (m.id === replyId && m.role === "assistant" ? applyEvent(m, event) : m)));
          if (event.type === "confirm") {
            const request: PendingRequest = { requestId: event.requestId, toolUseId: event.toolUseId, name: event.name, title: event.title, summary: event.summary, args: event.args, status: "open" };
            for (const listener of requestListeners.current) listener(request);
          }
          if (event.type === "ui_call") {
            // UI tools run here, in the page, while the conversation stays on screen.
            const turn = turnId.current;
            void runUiTool(event, (href) => router.push(href)).then(async (outcome) => {
              if (outcome.note) {
                const note = { id: event.requestId, text: outcome.note };
                setMessages((list) => list.map((m) => (m.id === replyId && m.role === "assistant" ? { ...m, notes: [...(m.notes ?? []), note] } : m)));
              }
              if (turn) await transport.uiReply(turn, event.requestId, { text: outcome.text, isError: outcome.isError });
            });
          }
        });
      } catch (error) {
        setMessages((list) => list.map((m) => (m.id === replyId && m.role === "assistant" ? { ...m, status: "error", error: (error as Error).message } : m)));
      } finally {
        turnId.current = undefined;
        setStreaming(false);
      }
    },
    [available, conversationId, streaming, transport, router],
  );

  const stop = useCallback(async () => {
    if (turnId.current) await transport.stop(turnId.current);
  }, [transport]);

  const respond = useCallback(
    async (requestId: string, decision: { approve: boolean; note?: string }) => {
      if (!turnId.current) return;
      await transport.reply(turnId.current, requestId, { approved: decision.approve, ...(decision.note ? { note: decision.note } : {}) });
    },
    [transport],
  );

  const onReply = useCallback((cb: (reply: ReplyUpdate) => void) => {
    replyListeners.current.add(cb);
    return () => void replyListeners.current.delete(cb);
  }, []);
  const onRequest = useCallback((cb: (request: PendingRequest) => void) => {
    requestListeners.current.add(cb);
    return () => void requestListeners.current.delete(cb);
  }, []);

  const port = useMemo<AssistantPort>(
    () => ({ available, status: streaming ? "streaming" : "idle", send, stop, onReply, onRequest, respond, composerRef, open, close, isOpen }),
    [available, streaming, send, stop, onReply, onRequest, respond, open, close, isOpen],
  );

  const loadConversations = useCallback(async () => setConversations(await transport.list()), [transport]);
  const openConversation = useCallback(
    async (id: string) => {
      const stored = await transport.load(id);
      setConversationId(id);
      setMessages(stored.messages.map(messageView));
    },
    [transport],
  );
  const newConversation = useCallback(() => {
    setConversationId(undefined);
    setMessages([]);
    focusComposer();
  }, [focusComposer]);
  const panel = useMemo<PanelState>(
    () => ({ messages, conversationId, conversations, loadConversations, openConversation, newConversation }),
    [messages, conversationId, conversations, loadConversations, openConversation, newConversation],
  );

  return (
    <PortContext.Provider value={port}>
      <PanelContext.Provider value={panel}>{children}</PanelContext.Provider>
    </PortContext.Provider>
  );
}
