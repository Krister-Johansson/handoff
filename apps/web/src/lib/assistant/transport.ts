import type { AssistantContent } from "@handoff/db";
import type { PageDescriptor } from "./page-tools";
import type { TurnEvent } from "@/server/assistant/relay";

/** What a turn's stream carries: the turn's id first, then its events. */
export type TurnStreamEvent = { type: "turn"; turnId: string } | TurnEvent;

export type ConversationSummary = { id: string; title: string; updatedAt: string };
export type StoredMessage = { id: string; role: "user" | "assistant"; content: AssistantContent };
export type StoredConversation = { conversation: ConversationSummary; messages: StoredMessage[] };

/** How the panel talks to the dashboard's assistant routes. The tests use a fake. */
export type AssistantTransport = {
  list(): Promise<ConversationSummary[]>;
  create(text: string): Promise<ConversationSummary>;
  load(id: string): Promise<StoredConversation>;
  /**
   * Starts a turn, with the page the person asks on when it has tools of its own, and calls `onEvent`
   * for each event of its stream; settles when the stream ends.
   */
  turn(conversationId: string, text: string, source: string, page: PageDescriptor | undefined, onEvent: (event: TurnStreamEvent) => void, signal?: AbortSignal): Promise<void>;
  reply(turnId: string, requestId: string, decision: { approved: boolean; note?: string }): Promise<void>;
  /** The page's answer to a UI tool call. */
  uiReply(turnId: string, requestId: string, result: { text: string; isError: boolean }): Promise<void>;
  stop(turnId: string): Promise<void>;
};

const json = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `The dashboard answered ${response.status}.`);
  return (await response.json()) as T;
};

const post = (url: string, body: unknown, signal?: AbortSignal) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });

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
  list: async () => json(await fetch("/api/assistant/conversations")),
  create: async (text) => json(await post("/api/assistant/conversations", { text })),
  load: async (id) => json(await fetch(`/api/assistant/conversations/${id}`)),
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
};
