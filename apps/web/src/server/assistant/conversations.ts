import { asc, assistantConversations, assistantMessages, desc, eq, isNotNull, sql, type AssistantContent, type Db } from "@handoff/db";

const TITLE_CHARS = 80;

/** A new conversation, titled after its first message. */
export async function createConversation(db: Db, firstMessage: string) {
  const title = firstMessage.trim().replace(/\s+/g, " ").slice(0, TITLE_CHARS) || "New conversation";
  const [row] = await db.insert(assistantConversations).values({ title }).returning();
  return row!;
}

/** Conversations, the most recently used first. */
export async function listConversations(db: Db, limit = 30) {
  return db.select().from(assistantConversations).orderBy(desc(assistantConversations.updatedAt)).limit(limit);
}

export async function getConversation(db: Db, id: string) {
  const [row] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, id));
  return row;
}

/** A conversation's messages in the order they were written. */
export async function conversationMessages(db: Db, id: string) {
  return db.select().from(assistantMessages).where(eq(assistantMessages.conversationId, id)).orderBy(asc(assistantMessages.createdAt));
}

/** Stores a message of a turn, and marks the conversation as just used. */
export async function storeMessage(db: Db, input: { conversationId: string; turnId: string; role: "user" | "assistant"; content: AssistantContent }) {
  await db.insert(assistantMessages).values(input);
  await db.update(assistantConversations).set({ updatedAt: sql`now()` }).where(eq(assistantConversations.id, input.conversationId));
}

/** Records the Claude Code session a conversation's turn ran in, and the model Claude Code reported. */
export async function setConversationSession(db: Db, id: string, session: { cliSessionId?: string | undefined; model?: string | undefined }) {
  const values = { ...(session.cliSessionId ? { cliSessionId: session.cliSessionId } : {}), ...(session.model ? { model: session.model } : {}) };
  if (Object.keys(values).length) await db.update(assistantConversations).set(values).where(eq(assistantConversations.id, id));
}

/** The model the latest turn of any conversation ran, for the settings page. */
export async function lastAssistantModel(db: Db): Promise<string | undefined> {
  const [row] = await db
    .select({ model: assistantConversations.model })
    .from(assistantConversations)
    .where(isNotNull(assistantConversations.model))
    .orderBy(desc(assistantConversations.updatedAt))
    .limit(1);
  return row?.model ?? undefined;
}
