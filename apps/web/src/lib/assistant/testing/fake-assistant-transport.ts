import type { PageDescriptor } from "../page-tools";
import type { AppViewResource, AssistantTransport, ChatListQuery, ConversationSummary, StoredConversation, TurnStreamEvent } from "../transport";

/** A chat for the tests, with the fields they leave out filled in. */
export function fakeChat(chat: Partial<ConversationSummary> & { id: string; title: string }): ConversationSummary {
  return { updatedAt: new Date().toISOString(), pinnedAt: null, project: null, lastMessage: null, state: null, ...chat };
}

type Stream = { onEvent: (event: TurnStreamEvent) => void; finish: () => void; signal?: AbortSignal | undefined };

/**
 * A transport the tests drive by hand: each started turn waits for the test to push its events, and
 * every call is recorded. A followed turn (`follow`) is driven the same way, with `emit`.
 */
export class FakeAssistantTransport implements AssistantTransport {
  conversations: ConversationSummary[] = [];
  stored = new Map<string, StoredConversation>();
  readonly lists: ChatListQuery[] = [];
  readonly creates: { text: string; path?: string }[] = [];
  readonly turns: { conversationId: string; text: string; source: string; page?: PageDescriptor }[] = [];
  readonly follows: string[] = [];
  readonly replies: { turnId: string; requestId: string; approved: boolean; note?: string }[] = [];
  readonly uiReplies: { turnId: string; requestId: string; text: string; isError: boolean }[] = [];
  readonly stops: string[] = [];
  readonly renames: { id: string; title: string }[] = [];
  readonly pins: { id: string; pinned: boolean }[] = [];
  readonly removes: string[] = [];
  /** Signals of streams the panel let go of. */
  readonly aborted: string[] = [];
  private stream: Stream | undefined;
  private next = 1;

  async list(query: ChatListQuery = {}) {
    this.lists.push(query);
    const words = query.query?.toLowerCase();
    const matching = this.conversations.filter(
      (c) =>
        (!words || c.title.toLowerCase().includes(words) || c.lastMessage?.toLowerCase().includes(words)) &&
        (!query.projectId || (query.projectId === "none" ? !c.project : c.project?.id === query.projectId)),
    );
    const pinned = matching.filter((c) => c.pinnedAt);
    const recent = matching.filter((c) => !c.pinnedAt).slice(0, query.limit ?? 30);
    return { conversations: [...pinned, ...recent], total: matching.length };
  }
  async create(text: string, path?: string) {
    this.creates.push({ text, ...(path ? { path } : {}) });
    const conversation = fakeChat({ id: `c${this.next++}`, title: text.slice(0, 80) });
    this.conversations = [conversation, ...this.conversations];
    return conversation;
  }
  async load(id: string) {
    const stored = this.stored.get(id);
    if (stored) return stored;
    const conversation = this.conversations.find((c) => c.id === id);
    if (!conversation) throw new Error("There is no such chat.");
    return { conversation: { ...conversation, turnId: null }, messages: [] };
  }
  async rename(id: string, title: string) {
    this.renames.push({ id, title });
    this.conversations = this.conversations.map((c) => (c.id === id ? { ...c, title } : c));
  }
  async pin(id: string, pinned: boolean) {
    this.pins.push({ id, pinned });
    this.conversations = this.conversations.map((c) => (c.id === id ? { ...c, pinnedAt: pinned ? new Date().toISOString() : null } : c));
  }
  async remove(id: string) {
    this.removes.push(id);
    this.conversations = this.conversations.filter((c) => c.id !== id);
    this.stored.delete(id);
  }
  turn(conversationId: string, text: string, source: string, page: PageDescriptor | undefined, onEvent: (event: TurnStreamEvent) => void, signal?: AbortSignal) {
    this.turns.push({ conversationId, text, source, ...(page ? { page } : {}) });
    return this.open(conversationId, onEvent, signal);
  }
  follow(turnId: string, onEvent: (event: TurnStreamEvent) => void, signal?: AbortSignal) {
    this.follows.push(turnId);
    return this.open(turnId, onEvent, signal);
  }
  async reply(turnId: string, requestId: string, decision: { approved: boolean; note?: string }) {
    this.replies.push({ turnId, requestId, ...decision });
  }
  async uiReply(turnId: string, requestId: string, result: { text: string; isError: boolean }) {
    this.uiReplies.push({ turnId, requestId, ...result });
  }
  async stop(turnId: string) {
    this.stops.push(turnId);
  }
  /** The views a test gives; any other view fails to load, as when the dashboard does not answer. */
  readonly views = new Map<string, AppViewResource>();
  readonly viewLoads: string[] = [];
  async view(uri: string) {
    this.viewLoads.push(uri);
    const view = this.views.get(uri);
    if (!view) throw new Error(`There is no view ${uri}.`);
    return view;
  }
  /** What each server tool a view calls returns; a tool without one answers {}. */
  readonly toolResults = new Map<string, unknown>();
  readonly toolCalls: { name: string; args: unknown }[] = [];
  async callTool(name: string, args: unknown) {
    this.toolCalls.push({ name, args });
    return this.toolResults.get(name) ?? {};
  }

  /** Sends an event of the running turn to the panel; a terminal one ends the turn. */
  emit(event: TurnStreamEvent) {
    const stream = this.stream;
    if (!stream || stream.signal?.aborted) return;
    stream.onEvent(event);
    if (event.type === "done" || event.type === "interrupted" || event.type === "error") stream.finish();
  }

  private open(key: string, onEvent: (event: TurnStreamEvent) => void, signal?: AbortSignal) {
    return new Promise<void>((resolve) => {
      const stream: Stream = { onEvent, finish: resolve, signal };
      this.stream = stream;
      // Letting go of a stream ends it on the panel's side only, as the real transport's abort does.
      signal?.addEventListener("abort", () => {
        this.aborted.push(key);
        resolve();
      });
    });
  }
}
