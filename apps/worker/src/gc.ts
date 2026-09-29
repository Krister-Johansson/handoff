import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { and, inArray, lt, runs, type Db } from "@handoff/db";

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
