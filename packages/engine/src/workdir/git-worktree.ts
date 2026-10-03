import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Workdir, WorkdirProvider, WorkdirSpec } from "../types.ts";
import { withNetworkRetry } from "./network.ts";

const run = promisify(execFile);

export type GitWorktreeOptions = {
  /** HANDOFF_HOME: repos/ and worktrees/ live under it. */
  root: string;
  /** GIT_CONFIG_* environment per remote, e.g. an http.extraheader with a GitHub token. Never argv. */
  gitEnv?: (remoteUrl: string) => Promise<Record<string, string>>;
  /** The first wait before a failed clone or fetch is tried again; tests shorten it. */
  retryMs?: number;
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
        await this.network(() => this.git(this.options.root, ["clone", "-q", "--no-checkout", spec.remoteUrl, mirror], auth), () => rmSync(mirror, { recursive: true, force: true }));
      } else if (!existsSync(path)) {
        await this.network(() => this.git(mirror, ["fetch", "-q", "--prune", "origin"], auth));
      }
      const baseSha = await this.git(mirror, ["rev-parse", `origin/${spec.baseBranch}`]);
      if (existsSync(path)) return { path, baseSha };
      mkdirSync(join(this.options.root, "worktrees"), { recursive: true });
      if (spec.detached) {
        await this.git(mirror, ["worktree", "add", "-q", "--detach", path, baseSha]);
        return { path, baseSha };
      }
      const branchExists = (await this.git(mirror, ["branch", "--list", spec.branchName])) !== "";
      await this.git(
        mirror,
        branchExists
          ? ["worktree", "add", "-q", path, spec.branchName]
          : ["worktree", "add", "-q", "-b", spec.branchName, path, await this.startPoint(mirror, spec)],
      );
      return { path, baseSha };
    });
  }

  /**
   * Where a new run branch starts: the head of the branch the run continues, as this clone has it or
   * else as origin has it, and the base branch otherwise.
   */
  private async startPoint(mirror: string, spec: WorkdirSpec): Promise<string> {
    const base = `origin/${spec.baseBranch}`;
    if (!spec.startFrom) return base;
    for (const ref of [`refs/heads/${spec.startFrom}`, `refs/remotes/origin/${spec.startFrom}`]) {
      const found = await this.git(mirror, ["rev-parse", "--verify", "--quiet", ref]).catch(() => "");
      if (found) return ref;
    }
    return base;
  }

  /**
   * Fetches the base branch and fast-forwards the run's worktree to it, when the branch has no commits
   * of its own: work that waited on a plan gate starts from the newest base instead of an old one.
   */
  fastForward(spec: WorkdirSpec): Promise<{ from: string; to: string } | undefined> {
    return this.serial(spec.remoteUrl, async () => {
      const mirror = this.mirrorPath(spec.remoteUrl);
      const path = this.worktreePath(spec.runId);
      if (!existsSync(path)) return undefined;
      const base = `origin/${spec.baseBranch}`;
      if ((await this.git(path, ["rev-list", "--count", `${base}..HEAD`])) !== "0") return undefined;
      const auth = (await this.options.gitEnv?.(spec.remoteUrl)) ?? {};
      await this.network(() => this.git(mirror, ["fetch", "-q", "--prune", "origin"], auth));
      const [from, to] = [await this.git(path, ["rev-parse", "HEAD"]), await this.git(path, ["rev-parse", base])];
      if (from === to || (await this.git(path, ["rev-list", "--count", `${base}..HEAD`])) !== "0") return undefined;
      await this.git(path, ["merge", "-q", "--ff-only", base]);
      return { from, to };
    });
  }

  release(spec: WorkdirSpec): Promise<void> {
    return this.serial(spec.remoteUrl, async () => {
      const mirror = this.mirrorPath(spec.remoteUrl);
      const path = this.worktreePath(spec.runId);
      // Nothing was ever checked out from a clone that does not exist.
      if (!existsSync(mirror)) return;
      if (existsSync(path)) await this.git(mirror, ["worktree", "remove", "--force", path]);
      await this.git(mirror, ["worktree", "prune"]);
    });
  }

  /** A clone or fetch, tried again when it fails; `cleanUp` removes what a failed try left behind first. */
  private network<T>(command: () => Promise<T>, cleanUp?: () => void): Promise<T> {
    return withNetworkRetry(async () => {
      try {
        return await command();
      } catch (error) {
        cleanUp?.();
        throw error;
      }
    }, this.options.retryMs);
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
