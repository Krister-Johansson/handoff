import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { assistantConversations, assistantMessages, eq, runs } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import { gcAssistantConversations, gcClaudeSessions } from "./gc.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

function sessionDir(home: string, runId: string) {
  const dir = join(home, "claude-config", "projects", `-Users-x-handoff-worktrees-${runId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.jsonl"), "{}");
  return dir;
}

test("gc removes transcripts of runs that finished before the cutoff and keeps the rest", async () => {
  const home = mkdtempSync(join(tmpdir(), "handoff-home-"));
  const { run: old } = await seedRun(db);
  const { run: recent } = await seedRun(db);
  const { run: active } = await seedRun(db, { status: "running" });
  await db.update(runs).set({ status: "succeeded", finishedAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(runs.id, old.id));
  await db.update(runs).set({ status: "failed", finishedAt: new Date() }).where(eq(runs.id, recent.id));
  const dirs = { old: sessionDir(home, old.id), recent: sessionDir(home, recent.id), active: sessionDir(home, active.id) };

  const removed = await gcClaudeSessions(db, { home, olderThanDays: 7 });
  expect(removed).toEqual([dirs.old]);
  expect(existsSync(dirs.old)).toBe(false);
  expect(existsSync(dirs.recent)).toBe(true);
  expect(existsSync(dirs.active)).toBe(true);
});

test("handoff gc removes assistant conversations older than the given days and their transcripts", async () => {
  const home = mkdtempSync(join(tmpdir(), "handoff-home-"));
  const old = "aaaaaaaa-0000-4000-8000-000000000001";
  const recent = "aaaaaaaa-0000-4000-8000-000000000002";
  const [stale] = await db
    .insert(assistantConversations)
    .values({ title: "Old", cliSessionId: old, updatedAt: new Date(Date.now() - 40 * 86_400_000) })
    .returning();
  const [fresh] = await db.insert(assistantConversations).values({ title: "New", cliSessionId: recent }).returning();
  await db.insert(assistantMessages).values({ conversationId: stale!.id, turnId: crypto.randomUUID(), role: "user", content: { text: "Hi", source: "typed" } });
  // Every assistant turn runs in one working folder, so its transcripts share one projects folder.
  const project = join(home, "assistant", "claude-config", "projects", "-Users-x--handoff-assistant-cwd");
  mkdirSync(join(project, old), { recursive: true });
  writeFileSync(join(project, `${old}.jsonl`), "{}");
  writeFileSync(join(project, `${recent}.jsonl`), "{}");

  const removed = await gcAssistantConversations(db, { assistantHome: join(home, "assistant"), olderThanDays: 30 });
  expect(removed.conversations).toBe(1);
  expect(removed.transcripts.sort()).toEqual([join(project, old), join(project, `${old}.jsonl`)]);
  expect((await db.select().from(assistantConversations)).map((c) => c.id)).toEqual([fresh!.id]);
  expect(await db.select().from(assistantMessages)).toEqual([]);
  expect(existsSync(join(project, `${old}.jsonl`))).toBe(false);
  expect(existsSync(join(project, `${recent}.jsonl`))).toBe(true);
});
