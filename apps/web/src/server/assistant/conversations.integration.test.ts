import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { assistantConversations, assistantMessages, eq } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import {
  ChatAnsweringError,
  createConversation,
  deleteConversation,
  getChat,
  listChats,
  projectOfPath,
  renameConversation,
  setConversationPinned,
  storeMessage,
} from "./conversations";
import { closeTurn, openTurn, type LiveTurn } from "./relay";

const db = createTestDb();
const open: LiveTurn[] = [];
beforeEach(() => truncateAll(db));
afterEach(() => {
  for (const turn of open.splice(0)) closeTurn(turn);
});
afterAll(() => db.$client.end());

const turnOf = (conversationId: string) => {
  const turn = openTurn(conversationId);
  open.push(turn);
  return turn;
};
const say = (conversationId: string, text: string, role: "user" | "assistant" = "user") =>
  storeMessage(db, { conversationId, turnId: crypto.randomUUID(), role, content: role === "user" ? { text, source: "typed" } : { text, calls: [], outcome: "done" } });
const usedAt = (id: string, at: Date) => db.update(assistantConversations).set({ updatedAt: at }).where(eq(assistantConversations.id, id));
const row = async (id: string) => (await db.select().from(assistantConversations).where(eq(assistantConversations.id, id)))[0];

test("a page path names its project: a project page by its id, a run page by its run's project, anything else none", async () => {
  const { project, run } = await seedRun(db);
  expect(await projectOfPath(db, `/projects/${project.id}`)).toBe(project.id);
  expect(await projectOfPath(db, `/projects/${project.id}/plan?view=board`)).toBe(project.id);
  expect(await projectOfPath(db, `/runs/${run.id}/try/q1`)).toBe(project.id);
  expect(await projectOfPath(db, `/projects/${crypto.randomUUID()}/runs`)).toBeUndefined();
  expect(await projectOfPath(db, "/projects/not-an-id")).toBeUndefined();
  expect(await projectOfPath(db, "/inbox")).toBeUndefined();
  expect(await projectOfPath(db, undefined)).toBeUndefined();
});

test("a new chat belongs to the project of the page it was started on", async () => {
  const { project } = await seedRun(db);
  const inProject = await createConversation(db, "What is running?", { path: `/projects/${project.id}/runs` });
  const outside = await createConversation(db, "What needs me?", { path: "/inbox" });
  expect(inProject.projectId).toBe(project.id);
  expect(outside.projectId).toBeNull();
});

test("the list has every pinned chat first, then the most recently used others up to the limit, with project, last message and total", async () => {
  const { project } = await seedRun(db);
  const now = Date.now();
  const chats = [];
  for (let i = 0; i < 5; i++) {
    const chat = await createConversation(db, `Chat ${i}`, i % 2 ? { path: `/projects/${project.id}` } : {});
    await say(chat.id, `Question ${i}`);
    await say(chat.id, `Answer ${i}`, "assistant");
    await usedAt(chat.id, new Date(now - i * 60_000));
    chats.push(chat);
  }
  await setConversationPinned(db, chats[4]!.id, true);
  await setConversationPinned(db, chats[3]!.id, true);

  const { conversations, total } = await listChats(db, { limit: 2 });
  expect(total).toBe(5);
  expect(conversations.map((c) => c.title)).toEqual(["Chat 3", "Chat 4", "Chat 0", "Chat 1"]);
  expect(conversations[0]).toMatchObject({ pinnedAt: expect.any(Date), project: { id: project.id, name: project.name }, lastMessage: "Answer 3", state: null });
  expect(conversations[2]).toMatchObject({ pinnedAt: null, project: null, lastMessage: "Answer 0" });
});

test("search matches titles and message text, and the project filter takes a project or none", async () => {
  const { project } = await seedRun(db);
  const plan = await createConversation(db, "Plan the voice epic", { path: `/projects/${project.id}` });
  const merge = await createConversation(db, "Merge queue");
  await say(merge.id, "Which pull request is next for the VOICE work?");
  await createConversation(db, "Something else");

  expect((await listChats(db, { query: "voice" })).conversations.map((c) => c.id).sort()).toEqual([plan.id, merge.id].sort());
  expect((await listChats(db, { query: "voice", projectId: project.id })).conversations.map((c) => c.id)).toEqual([plan.id]);
  const none = await listChats(db, { projectId: "none" });
  expect(none.conversations.map((c) => c.title).sort()).toEqual(["Merge queue", "Something else"]);
  expect(none.total).toBe(2);
  expect((await listChats(db, { query: "100%_" })).conversations).toEqual([]);
});

test("a chat's state is answering while a turn runs and approval while a card waits", async () => {
  const quiet = await createConversation(db, "Quiet");
  const busy = await createConversation(db, "Busy");
  const asking = await createConversation(db, "Asking");
  const busyTurn = turnOf(busy.id);
  const askingTurn = turnOf(asking.id);
  void askingTurn.requestApproval({ toolUseId: "tu1", name: "cancel_run", title: "Cancel a run", summary: "Cancel run 1", args: {} }, 60_000);

  const states = Object.fromEntries((await listChats(db)).conversations.map((c) => [c.title, c.state]));
  expect(states).toEqual({ Quiet: null, Busy: "answering", Asking: "approval" });
  expect(await getChat(db, busy.id)).toMatchObject({ id: busy.id, state: "answering", turnId: busyTurn.id });
  expect(await getChat(db, quiet.id)).toMatchObject({ state: null, turnId: null, project: null });
  expect(await getChat(db, crypto.randomUUID())).toBeUndefined();
});

test("renaming trims and shortens the title, pinning sets and clears the time, and neither counts as using the chat", async () => {
  const chat = await createConversation(db, "First message");
  const lastUse = new Date(Date.now() - 5 * 86_400_000);
  await usedAt(chat.id, lastUse);

  expect(await renameConversation(db, chat.id, `  Shaping   tools ${"x".repeat(100)} `)).toBe(true);
  expect((await row(chat.id))!.title).toBe(`Shaping tools ${"x".repeat(66)}`);
  await expect(renameConversation(db, chat.id, "   ")).rejects.toThrow(/name/);
  expect(await setConversationPinned(db, chat.id, true)).toBe(true);
  expect((await row(chat.id))!.pinnedAt).toEqual(expect.any(Date));
  expect(await setConversationPinned(db, chat.id, false)).toBe(true);
  expect((await row(chat.id))!.pinnedAt).toBeNull();
  expect((await row(chat.id))!.updatedAt.toISOString()).toBe(lastUse.toISOString());
  expect(await renameConversation(db, crypto.randomUUID(), "Gone")).toBe(false);
  expect(await setConversationPinned(db, crypto.randomUUID(), true)).toBe(false);
});

test("deleting a chat removes its messages and its Claude Code transcript, and is refused while it answers", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-config-"));
  const session = "aaaaaaaa-0000-4000-8000-000000000009";
  const other = "aaaaaaaa-0000-4000-8000-000000000010";
  const folder = join(configDir, "projects", "-x--handoff-assistant-cwd");
  mkdirSync(join(folder, session), { recursive: true });
  writeFileSync(join(folder, `${session}.jsonl`), "{}");
  writeFileSync(join(folder, `${other}.jsonl`), "{}");
  const chat = await createConversation(db, "Delete me");
  await db.update(assistantConversations).set({ cliSessionId: session }).where(eq(assistantConversations.id, chat.id));
  await say(chat.id, "Hi");
  const kept = await createConversation(db, "Keep me");

  const turn = turnOf(chat.id);
  await expect(deleteConversation(db, chat.id, { configDir })).rejects.toBeInstanceOf(ChatAnsweringError);
  closeTurn(turn);

  expect(await deleteConversation(db, chat.id, { configDir })).toBe(true);
  expect(await row(chat.id)).toBeUndefined();
  expect(await db.select().from(assistantMessages).where(eq(assistantMessages.conversationId, chat.id))).toEqual([]);
  expect(existsSync(join(folder, `${session}.jsonl`))).toBe(false);
  expect(existsSync(join(folder, session))).toBe(false);
  expect(existsSync(join(folder, `${other}.jsonl`))).toBe(true);
  expect(await row(kept.id)).toBeDefined();
  expect(await deleteConversation(db, chat.id, { configDir })).toBe(false);
  expect(await deleteConversation(db, "c1", { configDir })).toBe(false);
  expect(await renameConversation(db, "c1", "Name")).toBe(false);
  expect(await setConversationPinned(db, "c1", true)).toBe(false);
});
