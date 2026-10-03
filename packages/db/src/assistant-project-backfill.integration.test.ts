import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeEach, expect, test } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { assistantConversations, assistantMessages, type AssistantContent } from "./schema/index.ts";
import { createTestDb, seedRun, truncateAll } from "./testing/index.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const folder = readdirSync(new URL("../drizzle/", import.meta.url)).find((name) => name.endsWith("_assistant_chat_projects"));
const backfill = readFileSync(new URL(`../drizzle/${folder}/migration.sql`, import.meta.url), "utf8");

async function chat(title: string, pages: (string | undefined)[], values: Partial<typeof assistantConversations.$inferInsert> = {}) {
  const [conversation] = await db.insert(assistantConversations).values({ title, ...values }).returning();
  let at = Date.now() - 60_000;
  for (const path of pages) {
    const content: AssistantContent = { text: title, source: "typed", ...(path ? { page: { kind: "run", path } } : {}) };
    await db.insert(assistantMessages).values({ conversationId: conversation!.id, turnId: crypto.randomUUID(), role: "user", content, createdAt: new Date((at += 1000)) });
    await db.insert(assistantMessages).values({ conversationId: conversation!.id, turnId: crypto.randomUUID(), role: "assistant", content: { text: "ok", calls: [], outcome: "done" }, createdAt: new Date((at += 1000)) });
  }
  return conversation!;
}

test("older chats get the project of the first page their messages were asked on that names one", async () => {
  const { project: a, run: runOfA } = await seedRun(db);
  const { project: b } = await seedRun(db);
  const chats = {
    projectPage: await chat("On a project page", [`/projects/${a.id}/runs/${runOfA.id}`]),
    runPage: await chat("On a run page", [`/runs/${runOfA.id}/try/q1?step=2`]),
    firstWins: await chat("First page wins", [undefined, `/projects/${b.id}/graphs/linear`, `/projects/${a.id}`]),
    noPage: await chat("Asked on the inbox", ["/inbox", undefined]),
    unknown: await chat("A project that is gone", [`/projects/${crypto.randomUUID()}/plan`]),
    kept: await chat("Already has one", [`/projects/${a.id}`], { projectId: b.id }),
  };

  await db.execute(sql.raw(backfill));
  const projectOf = async (id: string) => (await db.select({ projectId: assistantConversations.projectId }).from(assistantConversations).where(eq(assistantConversations.id, id)))[0]!.projectId;
  expect(await projectOf(chats.projectPage.id)).toBe(a.id);
  expect(await projectOf(chats.runPage.id)).toBe(a.id);
  expect(await projectOf(chats.firstWins.id)).toBe(b.id);
  expect(await projectOf(chats.noPage.id)).toBeNull();
  expect(await projectOf(chats.unknown.id)).toBeNull();
  expect(await projectOf(chats.kept.id)).toBe(b.id);
});

test("the backfill leaves when a chat was last used alone", async () => {
  const { project } = await seedRun(db);
  const updatedAt = new Date(Date.now() - 20 * 86_400_000);
  const old = await chat("Old", [`/projects/${project.id}`], { updatedAt });
  await db.update(assistantConversations).set({ updatedAt }).where(eq(assistantConversations.id, old.id));

  await db.execute(sql.raw(backfill));
  const [row] = await db.select().from(assistantConversations).orderBy(asc(assistantConversations.createdAt));
  expect(row!.projectId).toBe(project.id);
  expect(row!.updatedAt.toISOString()).toBe(updatedAt.toISOString());
});

test("a chat keeps its pinned time, and deleting its project leaves the chat without one", async () => {
  const { project } = await seedRun(db);
  const pinnedAt = new Date();
  const [row] = await db.insert(assistantConversations).values({ title: "Pinned", projectId: project.id, pinnedAt }).returning();
  expect(row!.pinnedAt!.toISOString()).toBe(pinnedAt.toISOString());

  await db.execute(sql`delete from runs where project_id = ${project.id}`);
  await db.execute(sql`delete from graph_versions where graph_id in (select id from graphs where project_id = ${project.id})`);
  await db.execute(sql`delete from graphs where project_id = ${project.id}`);
  await db.execute(sql`delete from projects where id = ${project.id}`);
  const [after] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, row!.id));
  expect(after!.projectId).toBeNull();
});
