import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseUnifiedDiff, type DiffFile } from "@handoff/core";
import type { ExecutorContext } from "../types.ts";

const execFileAsync = promisify(execFile);

/**
 * What the run's branch changed against its base, with enough context that each file comes back
 * whole: the same comparison the owned-paths check makes. Undefined without a worktree or when git fails.
 */
export async function branchDiff(run: Pick<ExecutorContext["run"], "worktreePath" | "baseBranch">): Promise<DiffFile[] | undefined> {
  if (!run.worktreePath) return undefined;
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--no-color", "--no-ext-diff", "--full-index", "-M", "-U100000", `origin/${run.baseBranch}...HEAD`], {
      cwd: run.worktreePath,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return parseUnifiedDiff(stdout);
  } catch {
    return undefined;
  }
}
