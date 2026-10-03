import { index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tstz, updatedAt } from "./columns.ts";
import { projects } from "./projects.ts";

export const assistantRole = pgEnum("assistant_role", ["user", "assistant"]);

/** One tool call of an assistant reply: what it asked, what came back, and the person's approval when it needed one. */
export type AssistantCall = { id: string; name: string; args: unknown; result?: string; isError?: boolean; approval?: { approved: boolean; note?: string; at: string } };

/**
 * A message of a conversation: the person's text, where it came from and the dashboard page it was asked
 * on (its kind and path), or the assistant's reply with its tool calls.
 */
export type AssistantContent =
  | { text: string; source: string; page?: { kind: string; path: string } }
  | { text: string; calls: AssistantCall[]; outcome: "done" | "interrupted" | "error"; error?: string; costUsd?: number; usage?: unknown };

/**
 * A conversation with the dashboard's assistant. Its turns resume one Claude Code session. Its project is
 * the first project a page it was asked on names; a chat asked only outside a project has none.
 */
export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    id: id(),
    /** The first message, cut to 80 characters. */
    title: text("title").notNull(),
    /** The Claude Code session the first turn started; later turns resume it. */
    cliSessionId: text("cli_session_id"),
    model: text("model"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** When the person pinned the chat; `handoff gc` keeps pinned chats. */
    pinnedAt: tstz("pinned_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("assistant_conversations_updated_idx").on(t.updatedAt.desc())],
);

export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => assistantConversations.id, { onDelete: "cascade" }),
    /** The turn the message belongs to: a person's message and the reply share it. */
    turnId: uuid("turn_id").notNull(),
    role: assistantRole("role").notNull(),
    content: jsonb("content").$type<AssistantContent>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("assistant_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);
