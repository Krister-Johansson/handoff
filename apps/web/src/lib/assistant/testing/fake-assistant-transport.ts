import type { AssistantTransport, ConversationSummary, StoredConversation, TurnStreamEvent } from "../transport";

/**
 * A transport the tests drive by hand: each started turn waits for the test to push its events, and
 * every call is recorded.
 */
export class FakeAssistantTransport implements AssistantTransport {
  conversations: ConversationSummary[] = [];
  stored = new Map<string, StoredConversation>();
  readonly turns: { conversationId: string; text: string; source: string }[] = [];
  readonly replies: { turnId: string; requestId: string; approved: boolean; note?: string }[] = [];
  readonly stops: string[] = [];
  private emitter: ((event: TurnStreamEvent) => void) | undefined;
  private finish: (() => void) | undefined;
  private next = 1;

  async list() {
    return this.conversations;
  }
  async create(text: string) {
    const conversation = { id: `c${this.next++}`, title: text.slice(0, 80), updatedAt: new Date().toISOString() };
    this.conversations = [conversation, ...this.conversations];
    return conversation;
  }
  async load(id: string) {
    return this.stored.get(id) ?? { conversation: this.conversations.find((c) => c.id === id)!, messages: [] };
  }
  turn(conversationId: string, text: string, source: string, onEvent: (event: TurnStreamEvent) => void) {
    this.turns.push({ conversationId, text, source });
    this.emitter = onEvent;
    return new Promise<void>((resolve) => (this.finish = resolve));
  }
  async reply(turnId: string, requestId: string, decision: { approved: boolean; note?: string }) {
    this.replies.push({ turnId, requestId, ...decision });
  }
  async stop(turnId: string) {
    this.stops.push(turnId);
  }

  /** Sends an event of the running turn to the panel; a terminal one ends the turn. */
  emit(event: TurnStreamEvent) {
    this.emitter?.(event);
    if (event.type === "done" || event.type === "interrupted" || event.type === "error") this.finish?.();
  }
}
