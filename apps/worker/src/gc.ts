import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, assistantConversations, inArray, lt, runs, type Db } from "@handoff/db";

/**
 * Claude keeps a transcript per session under CLAUDE_CONFIG_DIR/projects/<encoded cwd>. A run's cwd
 * is its worktree, so the folder name contains the run id. Removes folders of runs that finished
 * more than `olderThanDays` ago. Active runs keep theirs, since a resume needs the transcript.
 */
export async function gcClaudeSessions(db: Db, opts: { home: string; olderThanDays: number }): Promise<string[]> {
  const root = join(opts.home, "claude-config", "projects");
  if (!existsSync(root)) return [];
  const cutoff = new Date(Date.now() - opts.olderThanDays * 86_400_000);
  const finished = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(inArray(runs.status, ["succeeded", "failed", "cancelled"]), lt(runs.finishedAt, cutoff)));
  const ids = finished.map((r) => r.id);
  const removed: string[] = [];
  for (const entry of readdirSync(root)) {
    if (ids.some((id) => entry.includes(id))) {
      const path = join(root, entry);
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    }
  }
  return removed;
}

/**
 * Where the dashboard keeps its assistant's files. The dashboard runs in apps/web and resolves
 * HANDOFF_HOME from there (or uses ~/.handoff without it), so the CLI, which runs in apps/worker,
 * resolves it the same way.
 */
export function dashboardAssistantHome(handoffHome: string | undefined): string {
  if (!handoffHome) return join(homedir(), ".handoff", "assistant");
  return resolve(fileURLToPath(new URL("../../web", import.meta.url)), handoffHome, "assistant");
}

/**
 * The dashboard's assistant keeps its conversations in Postgres and Claude's transcripts under
 * <assistant home>/claude-config/projects, one <session id>.jsonl (and a folder of the same name) per
 * conversation. Removes conversations not used for `olderThanDays`, with their messages and transcripts.
 */
export async function gcAssistantConversations(db: Db, opts: { assistantHome: string; olderThanDays: number }): Promise<{ conversations: number; transcripts: string[] }> {
  const cutoff = new Date(Date.now() - opts.olderThanDays * 86_400_000);
  const gone = await db.delete(assistantConversations).where(lt(assistantConversations.updatedAt, cutoff)).returning({ session: assistantConversations.cliSessionId });
  const sessions = new Set(gone.flatMap((c) => (c.session ? [c.session] : [])));
  const root = join(opts.assistantHome, "claude-config", "projects");
  const transcripts: string[] = [];
  if (sessions.size && existsSync(root)) {
    for (const project of readdirSync(root)) {
      for (const entry of readdirSync(join(root, project))) {
        if (sessions.has(entry.replace(/\.jsonl$/, ""))) {
          const path = join(root, project, entry);
          rmSync(path, { recursive: true, force: true });
          transcripts.push(path);
        }
      }
    }
  }
  return { conversations: gone.length, transcripts };
}
