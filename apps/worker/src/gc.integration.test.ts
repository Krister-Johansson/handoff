import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { assistantConversations, assistantMessages, eq, projects, runs } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import { GitWorktreeProvider } from "@handoff/engine";
import { gcAssistantConversations, gcClaudeSessions, gcFailedWorktrees } from "./gc.ts";

/** A bare repository with one commit on main, as a project's remote. */
function originRepo(): string {
  const work = mkdtempSync(join(tmpdir(), "handoff-seed-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd });
  git(work, "init", "-q", "-b", "main");
  writeFileSync(join(work, "README.md"), "# sample\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "initial");
  const origin = mkdtempSync(join(tmpdir(), "handoff-origin-"));
  git(origin, "clone", "-q", "--bare", work, ".");
  return origin;
}

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

test("gc removes the worktrees of runs that failed before the cutoff and keeps the rest", async () => {
  const workdirs = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
  const origin = originRepo();
  const failedRun = async (daysAgo: number) => {
    const { project, run } = await seedRun(db);
    const branchName = `handoff/${run.id}`;
    await db.update(projects).set({ localClonePath: origin }).where(eq(projects.id, project.id));
    const workdir = await workdirs.acquire({ runId: run.id, remoteUrl: origin, baseBranch: "main", branchName });
    await db.update(runs).set({ status: "failed", branchName, finishedAt: new Date(Date.now() - daysAgo * 86_400_000), worktreePath: workdir.path }).where(eq(runs.id, run.id));
    return workdir.path;
  };
  const old = await failedRun(10);
  const recent = await failedRun(1);

  const removed = await gcFailedWorktrees(db, { workdirs, olderThanDays: 7 });
  expect(removed).toEqual([old]);
  expect(existsSync(old)).toBe(false);
  expect(existsSync(recent)).toBe(true);
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
