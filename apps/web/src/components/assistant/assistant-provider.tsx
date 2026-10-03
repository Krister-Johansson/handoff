"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { toolSpec } from "@/lib/assistant/catalog";
import { isPageToolName } from "@/lib/assistant/page-tools";
import { runPageTool, type OpenPage } from "@/lib/assistant/run-page-tool";
import { pageDescriptor, runUiTool } from "@/lib/assistant/run-ui-tool";
import { pageToolsOnWebMcp, registerWebMcp, type WebMcpHost } from "@/lib/assistant/webmcp";
import { useWebMcpEnabled } from "@/lib/assistant/webmcp-pref";
import type { AssistantPort, ChatMessage, PendingRequest, ToolCallView } from "@/lib/assistant/port";
import { httpTransport, type AssistantTransport, type ChatList, type ChatListQuery, type ConversationSummary, type StoredConversation, type StoredMessage } from "@/lib/assistant/transport";
import { useChatList } from "./use-chat-list";
import { streamingReply, useTurnStream } from "./use-turn-stream";

/** How long a browser agent's approval card waits for the person before the call is denied. */
const AGENT_APPROVAL_TIMEOUT_MS = 5 * 60_000;

/**
 * Where this browser keeps the open chat's id, so a reload opens it again. The panel lives in the root
 * layout and stays open across pages, so the open chat belongs to the browser, not to a page's address.
 */
export const OPEN_CHAT_KEY = "handoff.assistant.chat";

function rememberOpenChat(id: string | undefined) {
  try {
    if (id) window.localStorage.setItem(OPEN_CHAT_KEY, id);
    else window.localStorage.removeItem(OPEN_CHAT_KEY);
  } catch {
    // Storage can be blocked; the chat then starts anew after a reload.
  }
}

function recallOpenChat(): string | undefined {
  try {
    return window.localStorage.getItem(OPEN_CHAT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}


/** What the panel, the sidebar and the Chats page need on top of the port: the open chat, its messages and the list of chats. */
type PanelState = {
  messages: ChatMessage[];
  /** Approval cards for tools a browser agent called through WebMCP, outside any conversation. */
  agentRequests: PendingRequest[];
  /** What a browser agent is doing now, for the status line. */
  agentActivity: string | undefined;
  /** Why the assistant is unavailable: no OAuth token, or switched off in Settings. */
  offReason: "no-token" | "off";
  conversationId: string | undefined;
  /** The open chat as the list shows it: its title and project. Undefined until the first message starts one. */
  conversation: ConversationSummary | undefined;
  /** Opens a chat in the panel, letting go of the one that streams. Throws when there is no such chat. */
  openConversation(id: string): Promise<void>;
  newConversation(): void;
  /** The sidebar's chats: every pinned one, the most recent others, and how many there are. Undefined until read. */
  chats: ChatList | undefined;
  /** Whether some chats are not in `chats` yet. */
  moreChats: boolean;
  /** Reads the next chats into `chats`, as the sidebar's Recents scrolls to its end. */
  showMoreChats(): Promise<void>;
  /** Changes whenever a chat is started, renamed, pinned, deleted or answers, so other lists can read again. */
  chatsVersion: number;
  refreshChats(): Promise<void>;
  /** Opens a chat and shows the panel. */
  showChat(id: string): Promise<void>;
  /** Starts a new chat and shows the panel. */
  startChat(): void;
  renameChat(id: string, title: string): Promise<void>;
  pinChat(id: string, pinned: boolean): Promise<void>;
  /** Deletes a chat; the open one gives way to a new chat. Refused while the chat answers. */
  deleteChat(id: string): Promise<void>;
  /** Reads chats for a list of its own, such as the Chats page: every pinned one, then up to `limit` others. */
  listChats(query: ChatListQuery): Promise<ChatList>;
};

const PortContext = createContext<AssistantPort | undefined>(undefined);
const PanelContext = createContext<PanelState | undefined>(undefined);

/** Registers the open page's tools with the provider; returns the function that removes them. */
type RegisterPage = (page: OpenPage) => () => void;
const PageRegistryContext = createContext<RegisterPage | undefined>(undefined);

/** How usePageTools reaches the provider; undefined outside one, as in a page's own tests. */
export function useOptionalPageRegistry(): RegisterPage | undefined {
  return useContext(PageRegistryContext);
}

/** The assistant, for any part of the dashboard: the panel, the header button, and later voice. */
export function useAssistant(): AssistantPort {
  const port = useContext(PortContext);
  if (!port) throw new Error("useAssistant needs an AssistantProvider.");
  return port;
}

/** The assistant where there may be none, as voice uses it. */
export function useOptionalAssistant(): AssistantPort | undefined {
  return useContext(PortContext);
}

export function useOptionalAssistantPanel(): PanelState | undefined {
  return useContext(PanelContext);
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
  if (stored.role === "user") return { id: stored.id, role: "user", text: content.text, ...("source" in content && content.source === "voice" ? { source: "voice" as const } : {}) };
  const reply = content as Extract<StoredMessage["content"], { calls: unknown }>;
  const status = reply.outcome === "done" ? "done" : reply.outcome === "interrupted" ? "stopped" : "error";
  return { id: stored.id, role: "assistant", text: reply.text, calls: reply.calls.map(callView), requests: [], status, ...(reply.error ? { error: reply.error } : {}) };
}

/** After a reload, the chat that was open opens again; one that is gone is forgotten, unless another chat opened meanwhile. */
function useRestoreOpenChat(transport: AssistantTransport, loads: Loads, show: (id: string, stored: StoredConversation) => void) {
  const restored = useEffectEvent(show);
  useEffect(() => {
    const id = recallOpenChat();
    if (!id) return;
    const load = loads.next();
    transport.load(id).then(
      (stored) => {
        if (loads.isLatest(load)) restored(id, stored);
      },
      () => {
        if (recallOpenChat() === id) rememberOpenChat(undefined);
      },
    );
  }, [transport, loads]);
}

/** Counts chat loads, so only the latest one shows when the person opens chats quickly one after another. */
type Loads = { next(): number; isLatest(load: number): boolean };
function useLoads(): Loads {
  const count = useRef(0);
  return useMemo(() => ({ next: () => ++count.current, isLatest: (load) => load === count.current }), []);
}

/**
 * Owns the assistant for the whole dashboard: the open conversation, its messages as they stream, the
 * approval cards, and the panel's open state. It lives in the root layout, so a navigation the
 * assistant makes leaves the conversation on screen. Mod+J opens the panel from anywhere.
 */
export function AssistantProvider({
  children,
  available,
  offReason = "no-token",
  transport = httpTransport,
}: {
  children: ReactNode;
  available: boolean;
  offReason?: "no-token" | "off";
  transport?: AssistantTransport;
}) {
  const [isOpen, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversation, setConversation] = useState<ConversationSummary>();
  const conversationId = conversation?.id;
  const chatList = useChatList(transport);
  const { chats, version: chatsVersion, refresh: refreshChats, changed: chatsChanged, pin: pinChat, list: listChats, more: moreChats, showMore: showMoreChats } = chatList;
  const router = useRouter();
  const [agentRequests, setAgentRequests] = useState<PendingRequest[]>([]);
  const [agentActivity, setAgentActivity] = useState<string>();
  const agentPending = useRef(new Map<string, (answer: { approved: boolean; note?: string }) => void>());
  const webMcpEnabled = useWebMcpEnabled();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const loads = useLoads();
  // The open page's tools. The last registration wins; removing one clears it only if it is still the open page.
  // pageVersion changes with every registration and removal, so the page's WebMCP tools follow the open page.
  const pageRef = useRef<OpenPage | undefined>(undefined);
  const [pageVersion, setPageVersion] = useState(0);
  const registerPage = useCallback<RegisterPage>((page) => {
    pageRef.current = page;
    setPageVersion((v) => v + 1);
    return () => {
      if (pageRef.current !== page) return;
      pageRef.current = undefined;
      setPageVersion((v) => v + 1);
    };
  }, []);
  const openPage = useCallback(() => pageRef.current, []);

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

  // UI tools run here, in the page, while the conversation stays on screen; page tools run in the page that is open now.
  const runUi = useCallback(
    (call: { requestId: string; name: string; args: unknown }) =>
      isPageToolName(call.name) ? runPageTool(openPage(), call) : runUiTool(call, { push: (href) => router.push(href), page: openPage }),
    [router, openPage],
  );
  const onStreamChange = useCallback(() => void chatsChanged(), [chatsChanged]);
  const { streaming, turnId, follow, release, onReply, onRequest } = useTurnStream({ transport, setMessages, runUi, onChange: onStreamChange });

  const send = useCallback(
    async (text: string, opts?: { source?: "voice" | "typed" }) => {
      const message = text.trim();
      if (!message || streaming || !available) return;
      const replyId = `reply-${Date.now()}`;
      const source = opts?.source ?? "typed";
      setMessages((list) => [...list, { id: `user-${Date.now()}`, role: "user", text: message, ...(source === "voice" ? { source } : {}) }, streamingReply(replyId)]);
      await follow(
        replyId,
        async (onEvent, signal) => {
          let id = conversationId;
          if (!id) {
            // A new chat belongs to the project of the page it was started on.
            const created = await transport.create(message, window.location.pathname);
            if (signal.aborted) return;
            id = created.id;
            setConversation(created);
            rememberOpenChat(created.id);
          }
          // The page the person asks on goes with the message, so the turn offers that page's tools.
          await transport.turn(id, message, source, pageDescriptor(openPage()), onEvent, signal);
        },
        { live: true },
      );
    },
    [available, conversationId, streaming, transport, openPage, follow],
  );

  const stop = useCallback(async () => {
    if (turnId.current) await transport.stop(turnId.current);
  }, [transport, turnId]);

  const respond = useCallback(
    async (requestId: string, decision: { approve: boolean; note?: string }) => {
      const agentAnswer = agentPending.current.get(requestId);
      if (agentAnswer) return agentAnswer({ approved: decision.approve, ...(decision.note ? { note: decision.note } : {}) });
      if (!turnId.current) return;
      await transport.reply(turnId.current, requestId, { approved: decision.approve, ...(decision.note ? { note: decision.note } : {}) });
    },
    [transport, turnId],
  );

  // Asks the person about a browser agent's call on an approval card in the panel; no answer in time denies it.
  const approveForAgent = useEffectEvent((call: { name: string; title: string; summary: string; args: unknown }) => {
    const requestId = `agent-${crypto.randomUUID()}`;
    open();
    return new Promise<{ approved: boolean; note?: string }>((resolve) => {
      const settle = (answer: { approved: boolean; note?: string }) => {
        clearTimeout(timer);
        agentPending.current.delete(requestId);
        setAgentRequests((list) => list.filter((r) => r.requestId !== requestId));
        resolve(answer);
      };
      const timer = setTimeout(() => settle({ approved: false, note: "No one approved this in time." }), AGENT_APPROVAL_TIMEOUT_MS);
      agentPending.current.set(requestId, settle);
      setAgentRequests((list) => [...list, { requestId, ...call, status: "open", expiresAt: new Date(Date.now() + AGENT_APPROVAL_TIMEOUT_MS).toISOString() }]);
    });
  });

  // WebMCP: while this browser allows it, every dashboard page offers the catalog to agents in the browser.
  useEffect(() => {
    if (!webMcpEnabled) return;
    const controller = new AbortController();
    const context = document.modelContext;
    const onActivated = (e: Event) => setAgentActivity(`A browser agent is filling ${(e as Event & { toolName?: string }).toolName ?? "a form"}`);
    const onCancel = () => setAgentActivity(undefined);
    context?.addEventListener("toolactivated", onActivated, { signal: controller.signal });
    context?.addEventListener("toolcancel", onCancel, { signal: controller.signal });
    void registerWebMcp(
      context,
      {
        approve: (call) => approveForAgent(call),
        runUi: (call) => runUiTool(call, { push: (href) => router.push(href), page: openPage }),
        runPage: (call) => runPageTool(openPage(), call),
        activity: setAgentActivity,
      },
      { available, signal: controller.signal },
    ).catch(() => {
      // A browser that refuses a registration keeps the dashboard working without WebMCP.
    });
    return () => controller.abort();
  }, [available, webMcpEnabled, router, openPage]);

  // WebMCP: the open page's tools register beside the catalog, and are replaced whenever a page registers or leaves.
  // The set lives as long as the switch; navigating goes through an effect event, so a new router object does not replace it.
  const pageWebMcp = useRef<ReturnType<typeof pageToolsOnWebMcp> | undefined>(undefined);
  const navigate = useEffectEvent((href: string) => router.push(href));
  useEffect(() => {
    if (!webMcpEnabled) return;
    const host: WebMcpHost = {
      approve: (call) => approveForAgent(call),
      runUi: (call) => runUiTool(call, { push: (href) => navigate(href), page: openPage }),
      runPage: (call) => runPageTool(openPage(), call),
      activity: setAgentActivity,
    };
    const pages = pageToolsOnWebMcp(document.modelContext, host, { available });
    pageWebMcp.current = pages;
    return () => {
      pages.clear();
      pageWebMcp.current = undefined;
    };
  }, [available, webMcpEnabled, openPage]);
  useEffect(() => {
    void pageWebMcp.current?.show(openPage());
  }, [pageVersion, available, webMcpEnabled, openPage]);

  const port = useMemo<AssistantPort>(
    () => ({ available, status: streaming ? "streaming" : "idle", send, stop, onReply, onRequest, respond, composerRef, open, close, isOpen }),
    [available, streaming, send, stop, onReply, onRequest, respond, open, close, isOpen],
  );

  // Shows a loaded chat in the panel: its messages, and its running turn when it still answers.
  const displayChat = useCallback(
    (id: string, stored: StoredConversation) => {
      setConversation(stored.conversation);
      rememberOpenChat(id);
      const messages = stored.messages.map(messageView);
      const running = stored.conversation.turnId;
      if (!running) {
        setMessages(messages);
        return;
      }
      const replyId = `reply-${running}`;
      setMessages([...messages, streamingReply(replyId)]);
      void follow(replyId, (onEvent, signal) => transport.follow(running, onEvent, signal), { live: false, turn: running });
    },
    [transport, follow],
  );
  const loadChat = useCallback(
    async (id: string) => {
      const load = loads.next();
      const stored = await transport.load(id);
      if (loads.isLatest(load)) displayChat(id, stored);
    },
    [transport, displayChat, loads],
  );
  /** Opens a chat, letting go of the one that streams. Throws when there is no such chat. */
  const openConversation = useCallback(
    (id: string) => {
      release();
      return loadChat(id);
    },
    [release, loadChat],
  );
  const newConversation = useCallback(() => {
    release();
    loads.next();
    setConversation(undefined);
    setMessages([]);
    rememberOpenChat(undefined);
    focusComposer();
  }, [focusComposer, release, loads]);

  const openChat = useCallback(
    async (id: string) => {
      await openConversation(id);
      open();
    },
    [openConversation, open],
  );
  const startChat = useCallback(() => {
    newConversation();
    open();
  }, [newConversation, open]);
  const renameChat = useCallback(
    async (id: string, title: string) => {
      await chatList.rename(id, title);
      setConversation((c) => (c?.id === id ? { ...c, title: title.trim().replace(/\s+/g, " ").slice(0, 80) } : c));
    },
    [chatList],
  );
  const deleteChat = useCallback(
    async (id: string) => {
      await chatList.remove(id);
      if (id === conversationId) newConversation();
    },
    [chatList, conversationId, newConversation],
  );

  useRestoreOpenChat(transport, loads, displayChat);

  const panel = useMemo<PanelState>(
    () => ({
      messages,
      agentRequests,
      agentActivity,
      offReason,
      conversationId,
      conversation,
      openConversation,
      newConversation,
      chats,
      moreChats,
      showMoreChats,
      chatsVersion,
      refreshChats,
      showChat: openChat,
      startChat,
      renameChat,
      pinChat,
      deleteChat,
      listChats,
    }),
    [messages, agentRequests, agentActivity, offReason, conversationId, conversation, openConversation, newConversation, chats, moreChats, showMoreChats, chatsVersion, refreshChats, openChat, startChat, renameChat, pinChat, deleteChat, listChats],
  );

  return (
    <PortContext.Provider value={port}>
      <PanelContext.Provider value={panel}>
        <PageRegistryContext.Provider value={registerPage}>{children}</PageRegistryContext.Provider>
      </PanelContext.Provider>
    </PortContext.Provider>
  );
}
