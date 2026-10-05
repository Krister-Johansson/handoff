import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { eq, runs, type DbExecutor } from "@handoff/db";
import type { WorktreeState } from "@/lib/worktree-state";

export type WorktreeRun = { id: string; status: (typeof runs.$inferSelect)["status"]; worktreePath: string | null; prNumber: number | null };

/**
 * The worker's HANDOFF_HOME, where it keeps one worktree per run. The worker runs in apps/worker and
 * resolves a relative HANDOFF_HOME (./.handoff by default) from there; the dashboard runs in apps/web
 * and reads the same .env, so it resolves the value from the worker's folder.
 */
export function workerHome(env: Record<string, string | undefined> = process.env, webDir = process.cwd()): string {
  return resolve(webDir, "..", "worker", env.HANDOFF_HOME || "./.handoff");
}

/** The path with the home folder shortened to ~, for people to read. */
function shorten(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/** A real folder, not a file or a symbolic link, at exactly this path. */
function isFolder(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Whether the run's worktree can be opened, and why not when it cannot. Only a stored path that is
 * exactly `<home>/worktrees/<run id>`, written as such (absolute, no `.` or `..`), and a folder on disk
 * gets a link; any other stored path reads as missing.
 */
export function worktreeState(run: WorktreeRun, home: string): WorktreeState {
  const stored = run.worktreePath;
  if (!stored) {
    if (run.status === "succeeded" || run.status === "cancelled") return { state: "released", prNumber: run.prNumber };
    if (run.status === "failed") return { state: "removed-by-gc" };
    return { state: "not-created" };
  }
  const expected = join(resolve(home), "worktrees", run.id);
  if (stored !== expected || !isFolder(stored)) return { state: "missing", shown: shorten(stored) };
  return { state: "open", path: stored, shown: shorten(stored), running: run.status === "running" };
}

/** The run's worktree state from its row and the disk; undefined for an unknown run. */
export async function runWorktree(db: DbExecutor, runId: string, home = workerHome()): Promise<WorktreeState | undefined> {
  const [run] = await db.select({ id: runs.id, status: runs.status, worktreePath: runs.worktreePath, prNumber: runs.prNumber }).from(runs).where(eq(runs.id, runId));
  return run && worktreeState(run, home);
}
