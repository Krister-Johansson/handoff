import { removeSessionTranscripts } from "@handoff/cli-adapter";
import {
  and,
  asc,
  assistantConversations,
  assistantMessages,
  desc,
  eq,
  isNotNull,
  isNull,
  projects,
  runs,
  sql,
  type AssistantContent,
  type Db,
  type SQL,
} from "@handoff/db";
import { liveTurnOf, type ChatState } from "./relay";

const TITLE_CHARS = 80;
const LAST_MESSAGE_CHARS = 200;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PROJECT_PATH = new RegExp(`^/projects/(${UUID})(?:[/?#]|$)`);
const RUN_PATH = new RegExp(`^/runs/(${UUID})(?:[/?#]|$)`);
const IS_UUID = new RegExp(`^${UUID}$`);

/** A title as the person or their first message wrote it: one line, at most 80 characters. */
const cleanTitle = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, TITLE_CHARS).trim();

/**
 * The project a dashboard page belongs to: /projects/<id>/... names it, /runs/<id>/... names the run's
 * project. The migration that filled in older chats reads paths the same way.
 */
export async function projectOfPath(db: Db, path: string | undefined): Promise<string | undefined> {
  const project = path?.match(PROJECT_PATH)?.[1];
  if (project) {
    const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, project));
    return row?.id;
  }
  const run = path?.match(RUN_PATH)?.[1];
  if (run) {
    const [row] = await db.select({ projectId: runs.projectId }).from(runs).where(eq(runs.id, run));
    return row?.projectId;
  }
  return undefined;
}

/** A new conversation, titled after its first message, in the project of the page it was started on. */
export async function createConversation(db: Db, firstMessage: string, opts: { path?: string } = {}) {
  const title = cleanTitle(firstMessage) || "New conversation";
  const projectId = await projectOfPath(db, opts.path);
  const [row] = await db
    .insert(assistantConversations)
    .values({ title, ...(projectId ? { projectId } : {}) })
    .returning();
  return row!;
}

/** Gives a conversation without a project the project of the page a later message was asked on. */
export async function claimProject(db: Db, id: string, path: string | undefined) {
  const projectId = await projectOfPath(db, path);
  if (!projectId) return;
  await db
    .update(assistantConversations)
    .set({ projectId, updatedAt: sql`${assistantConversations.updatedAt}` })
    .where(and(eq(assistantConversations.id, id), isNull(assistantConversations.projectId)));
}

/** The project a conversation is on, by id and name; undefined for a chat started outside a project. */
export async function conversationProject(db: Db, id: string): Promise<{ id: string; name: string } | undefined> {
  const [row] = await db
    .select({ id: projects.id, name: projects.name })
    .from(assistantConversations)
    .innerJoin(projects, eq(projects.id, assistantConversations.projectId))
    .where(eq(assistantConversations.id, id));
  return row;
}

/** A chat as the sidebar, the Chats page and the panel's header show it. */
export type ChatSummary = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  pinnedAt: Date | null;
  project: { id: string; name: string } | null;
  /** The start of the latest message, the person's or the reply's. */
  lastMessage: string | null;
  /** Answering while a turn runs, approval while one of its cards waits for the person. */
  state: ChatState | null;
};

export type ChatListOptions = {
  /** How many unpinned chats, the most recently used first; every pinned chat comes on top. */
  limit?: number;
  /** Matches titles and the text of messages, ignoring case. */
  query?: string;
  /** A project's id, or "none" for chats started outside a project. */
  projectId?: string;
};

const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

function chatSelect(db: Db) {
  return db
    .select({
      id: assistantConversations.id,
      title: assistantConversations.title,
      createdAt: assistantConversations.createdAt,
      updatedAt: assistantConversations.updatedAt,
      pinnedAt: assistantConversations.pinnedAt,
      projectId: projects.id,
      projectName: projects.name,
      lastMessage: sql<string | null>`(select left(m.content->>'text', ${LAST_MESSAGE_CHARS}) from ${assistantMessages} m where m.conversation_id = ${assistantConversations.id} order by m.created_at desc limit 1)`,
    })
    .from(assistantConversations)
    .leftJoin(projects, eq(projects.id, assistantConversations.projectId));
}

type ChatRow = Awaited<ReturnType<ReturnType<typeof chatSelect>["where"]>>[number];

function summary({ projectId, projectName, ...row }: ChatRow): ChatSummary {
  return { ...row, project: projectId && projectName ? { id: projectId, name: projectName } : null, state: liveTurnOf(row.id)?.state ?? null };
}

/** Conversations, every pinned one first, then the most recently used others; `total` counts all that match. */
export async function listChats(db: Db, opts: ChatListOptions = {}): Promise<{ conversations: ChatSummary[]; total: number }> {
  const filters: SQL[] = [];
  const query = opts.query?.trim();
  if (query) {
    const like = `%${escapeLike(query)}%`;
    filters.push(
      sql`(${assistantConversations.title} ilike ${like} or exists (select 1 from ${assistantMessages} m where m.conversation_id = ${assistantConversations.id} and m.content->>'text' ilike ${like}))`,
    );
  }
  if (opts.projectId === "none") filters.push(isNull(assistantConversations.projectId));
  else if (opts.projectId !== undefined) {
    if (!IS_UUID.test(opts.projectId)) return { conversations: [], total: 0 };
    filters.push(eq(assistantConversations.projectId, opts.projectId));
  }
  const limit = Math.max(0, Math.min(opts.limit ?? 30, 500));
  const [pinned, recent, [count]] = await Promise.all([
    chatSelect(db)
      .where(and(...filters, isNotNull(assistantConversations.pinnedAt)))
      .orderBy(desc(assistantConversations.updatedAt)),
    chatSelect(db)
      .where(and(...filters, isNull(assistantConversations.pinnedAt)))
      .orderBy(desc(assistantConversations.updatedAt))
      .limit(limit),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(assistantConversations)
      .where(and(...filters)),
  ]);
  return { conversations: [...pinned, ...recent].map(summary), total: count?.total ?? 0 };
}

/** One chat as the list shows it, with the running turn the panel can follow; undefined when there is none. */
export async function getChat(db: Db, id: string): Promise<(ChatSummary & { turnId: string | null }) | undefined> {
  if (!IS_UUID.test(id)) return undefined;
  const [row] = await chatSelect(db).where(eq(assistantConversations.id, id));
  if (!row) return undefined;
  return { ...summary(row), turnId: liveTurnOf(id)?.turn.id ?? null };
}

export async function getConversation(db: Db, id: string) {
  const [row] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, id));
  return row;
}

/** Renames a chat. Renaming does not count as using it, so its place in Recents and its gc clock stay. False when there is no such chat. */
export async function renameConversation(db: Db, id: string, title: string): Promise<boolean> {
  const name = cleanTitle(title);
  if (!name) throw new Error("Give the chat a name.");
  if (!IS_UUID.test(id)) return false;
  const rows = await db
    .update(assistantConversations)
    .set({ title: name, updatedAt: sql`${assistantConversations.updatedAt}` })
    .where(eq(assistantConversations.id, id))
    .returning({ id: assistantConversations.id });
  return rows.length > 0;
}

/** Pins or unpins a chat; `handoff gc` keeps pinned chats. Pinning does not count as using it. False when there is no such chat. */
export async function setConversationPinned(db: Db, id: string, pinned: boolean): Promise<boolean> {
  if (!IS_UUID.test(id)) return false;
  const rows = await db
    .update(assistantConversations)
    .set({ pinnedAt: pinned ? sql`coalesce(${assistantConversations.pinnedAt}, now())` : null, updatedAt: sql`${assistantConversations.updatedAt}` })
    .where(eq(assistantConversations.id, id))
    .returning({ id: assistantConversations.id });
  return rows.length > 0;
}

export class ChatAnsweringError extends Error {}

/**
 * Deletes a chat with its messages and its Claude Code transcript under `configDir`, as `handoff gc`
 * does. Refused while the chat answers. False when there is no such chat.
 */
export async function deleteConversation(db: Db, id: string, opts: { configDir: string }): Promise<boolean> {
  if (!IS_UUID.test(id)) return false;
  if (liveTurnOf(id)) throw new ChatAnsweringError("This chat is answering. Stop it first, then delete it.");
  const gone = await db.delete(assistantConversations).where(eq(assistantConversations.id, id)).returning({ session: assistantConversations.cliSessionId });
  if (!gone.length) return false;
  removeSessionTranscripts(
    opts.configDir,
    gone.flatMap((c) => (c.session ? [c.session] : [])),
  );
  return true;
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
