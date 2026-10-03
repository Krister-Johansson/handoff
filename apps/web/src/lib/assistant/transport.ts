import type { AssistantContent } from "@handoff/db";
import type { PageDescriptor } from "./page-tools";
import type { TurnEvent } from "@/server/assistant/relay";

/** What a turn's stream carries: the turn's id first, then its events. */
export type TurnStreamEvent = { type: "turn"; turnId: string } | TurnEvent;

/** What a chat is doing now: answering while a turn runs, approval while one of its cards waits. */
export type ChatState = "answering" | "approval";

/** A chat as the list routes send it. */
export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  pinnedAt: string | null;
  project: { id: string; name: string } | null;
  lastMessage: string | null;
  state: ChatState | null;
};
export type StoredMessage = { id: string; role: "user" | "assistant"; content: AssistantContent };
/** A chat with its messages, and the turn it runs now, which the panel can follow. */
export type StoredConversation = { conversation: ConversationSummary & { turnId: string | null }; messages: StoredMessage[] };
export type ChatList = { conversations: ConversationSummary[]; total: number };
export type ChatListQuery = { limit?: number; query?: string; projectId?: string };

/** How the panel talks to the dashboard's assistant routes. The tests use a fake. */
export type AssistantTransport = {
  /** Every pinned chat, then up to `limit` others by last use. */
  list(query?: ChatListQuery): Promise<ChatList>;
  /** Starts a chat on the page at `path`, which gives it its project. */
  create(text: string, path?: string): Promise<ConversationSummary>;
  /** Throws when there is no such chat. */
  load(id: string): Promise<StoredConversation>;
  rename(id: string, title: string): Promise<void>;
  pin(id: string, pinned: boolean): Promise<void>;
  /** Deletes a chat with its messages and transcript; refused while it answers. */
  remove(id: string): Promise<void>;
  /**
   * Starts a turn, with the page the person asks on when it has tools of its own, and calls `onEvent`
   * for each event of its stream; settles when the stream ends.
   */
  turn(conversationId: string, text: string, source: string, page: PageDescriptor | undefined, onEvent: (event: TurnStreamEvent) => void, signal?: AbortSignal): Promise<void>;
  reply(turnId: string, requestId: string, decision: { approved: boolean; note?: string }): Promise<void>;
  /** The page's answer to a UI tool call. */
  uiReply(turnId: string, requestId: string, result: { text: string; isError: boolean }): Promise<void>;
  stop(turnId: string): Promise<void>;
  /** Follows a running turn from its first event, as after a reload; settles when its stream ends. */
  follow(turnId: string, onEvent: (event: TurnStreamEvent) => void, signal?: AbortSignal): Promise<void>;
};

const json = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `The dashboard answered ${response.status}.`);
  return (await response.json()) as T;
};

const post = (url: string, body: unknown, signal?: AbortSignal, method = "POST") =>
  fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });

/** Reads server-sent events from a response body, one data line per event. */
async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (event: TurnStreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split("\n").find((l) => l.startsWith("data: "));
      if (data) onEvent(JSON.parse(data.slice(6)) as TurnStreamEvent);
    }
  }
}

/** The transport over the dashboard's own /api/assistant routes. */
export const httpTransport: AssistantTransport = {
  async list(query = {}) {
    const search = new URLSearchParams();
    if (query.limit !== undefined) search.set("limit", String(query.limit));
    if (query.query) search.set("q", query.query);
    if (query.projectId) search.set("project", query.projectId);
    const qs = search.toString();
    return json(await fetch(`/api/assistant/conversations${qs ? `?${qs}` : ""}`));
  },
  create: async (text, path) => json(await post("/api/assistant/conversations", { text, ...(path ? { path } : {}) })),
  load: async (id) => json(await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`)),
  async rename(id, title) {
    await json(await post(`/api/assistant/conversations/${encodeURIComponent(id)}`, { title }, undefined, "PATCH"));
  },
  async pin(id, pinned) {
    await json(await post(`/api/assistant/conversations/${encodeURIComponent(id)}`, { pinned }, undefined, "PATCH"));
  },
  async remove(id) {
    await json(await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }));
  },
  async turn(conversationId, text, source, page, onEvent, signal) {
    const response = await post(`/api/assistant/conversations/${conversationId}/turns`, { text, source, ...(page ? { page } : {}) }, signal);
    if (!response.ok || !response.body) {
      const error = ((await response.json().catch(() => ({}))) as { error?: string }).error;
      onEvent({ type: "error", message: error ?? `The dashboard answered ${response.status}.` });
      return;
    }
    await readEvents(response.body, onEvent);
  },
  async reply(turnId, requestId, decision) {
    await post(`/api/assistant/turns/${turnId}/replies`, { requestId, ...decision });
  },
  async uiReply(turnId, requestId, result) {
    await post(`/api/assistant/turns/${turnId}/replies`, { requestId, result: result.text, isError: result.isError });
  },
  async stop(turnId) {
    await post(`/api/assistant/turns/${turnId}/stop`, {});
  },
  async follow(turnId, onEvent, signal) {
    const response = await fetch(`/api/assistant/turns/${encodeURIComponent(turnId)}/events`, signal ? { signal } : {});
    // A turn that ended in the meantime has nothing to follow; its reply is stored.
    if (!response.ok || !response.body) return;
    await readEvents(response.body, onEvent);
  },
};
