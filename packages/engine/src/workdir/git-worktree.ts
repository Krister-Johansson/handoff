import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Workdir, WorkdirProvider, WorkdirSpec } from "../types.ts";

const run = promisify(execFile);

export type GitWorktreeOptions = {
  /** HANDOFF_HOME: repos/ and worktrees/ live under it. */
  root: string;
  /** GIT_CONFIG_* environment per remote, e.g. an http.extraheader with a GitHub token. Never argv. */
  gitEnv?: (remoteUrl: string) => Promise<Record<string, string>>;
};

/** One clone per remote under repos/, one worktree per run under worktrees/, on the run's branch. */
export class GitWorktreeProvider implements WorkdirProvider {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: GitWorktreeOptions) {}

  mirrorPath(remoteUrl: string): string {
    return join(this.options.root, "repos", createHash("sha1").update(remoteUrl).digest("hex").slice(0, 16));
  }

  worktreePath(runId: string): string {
    return join(this.options.root, "worktrees", runId);
  }

  acquire(spec: WorkdirSpec): Promise<Workdir> {
    return this.serial(spec.remoteUrl, async () => {
      const mirror = this.mirrorPath(spec.remoteUrl);
      const path = this.worktreePath(spec.runId);
      const auth = (await this.options.gitEnv?.(spec.remoteUrl)) ?? {};
      if (!existsSync(mirror)) {
        mkdirSync(join(this.options.root, "repos"), { recursive: true });
        await this.git(this.options.root, ["clone", "-q", "--no-checkout", spec.remoteUrl, mirror], auth);
      } else if (!existsSync(path)) {
        await this.git(mirror, ["fetch", "-q", "--prune", "origin"], auth);
      }
      const baseSha = await this.git(mirror, ["rev-parse", `origin/${spec.baseBranch}`]);
      if (existsSync(path)) return { path, baseSha };
      mkdirSync(join(this.options.root, "worktrees"), { recursive: true });
      const branchExists = (await this.git(mirror, ["branch", "--list", spec.branchName])) !== "";
      await this.git(
        mirror,
        branchExists
          ? ["worktree", "add", "-q", path, spec.branchName]
          : ["worktree", "add", "-q", "-b", spec.branchName, path, `origin/${spec.baseBranch}`],
      );
      return { path, baseSha };
    });
  }

  release(spec: WorkdirSpec): Promise<void> {
    return this.serial(spec.remoteUrl, async () => {
      const mirror = this.mirrorPath(spec.remoteUrl);
      const path = this.worktreePath(spec.runId);
      if (existsSync(path)) await this.git(mirror, ["worktree", "remove", "--force", path]);
      await this.git(mirror, ["worktree", "prune"]);
    });
  }

  private async git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
    const { stdout } = await run("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } });
    return stdout.trim();
  }

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.locks.set(key, next);
    return next;
  }
}
