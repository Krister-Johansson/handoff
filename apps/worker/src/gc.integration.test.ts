import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, runs } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import { gcClaudeSessions } from "./gc.ts";

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
