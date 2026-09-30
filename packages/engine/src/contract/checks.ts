import { execFile, spawn } from "node:child_process";
import { matchesGlob } from "node:path";
import { promisify } from "node:util";
import type { CheckResult, DeterministicCheck, RunState } from "@handoff/core";

const execFileAsync = promisify(execFile);
const TAIL_LINES = 200;

export type CheckContext = { state: RunState; baseBranch: string; workdir?: string | undefined; container?: string | undefined };

/** Runs a shell command in the worktree, or inside the run's container when one is given. */
export async function shell(
  command: string,
  cwd: string,
  timeoutMs: number,
  container?: string,
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = container
      ? spawn("docker", ["exec", "-w", cwd, container, "sh", "-c", command], { stdio: ["ignore", "pipe", "pipe"] })
      : spawn("sh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const lines: string[] = [];
    const collect = (chunk: Buffer) => {
      lines.push(...chunk.toString("utf8").split("\n"));
      if (lines.length > TAIL_LINES * 2) lines.splice(0, lines.length - TAIL_LINES);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, output: lines.slice(-TAIL_LINES).join("\n").trim(), timedOut });
    });
  });
}

async function changedFiles(workdir: string, baseBranch: string): Promise<string[]> {
  const git = async (args: string[]) => (await execFileAsync("git", args, { cwd: workdir })).stdout;
  const committed = (await git(["diff", "--name-only", `origin/${baseBranch}...HEAD`])).split("\n");
  const status = (await git(["status", "--porcelain=v1", "-uall"]))
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1)!);
  return [...new Set([...committed, ...status].map((f) => f.trim()).filter(Boolean))].sort();
}

const hasGlob = (p: string) => /[*?[{]/.test(p);
export function isOwned(file: string, patterns: string[]): boolean {
  return patterns.some((p) => (hasGlob(p) ? matchesGlob(file, p) : file === p || file.startsWith(`${p.replace(/\/$/, "")}/`)));
}

function needWorkdir(check: DeterministicCheck, ctx: CheckContext): string {
  if (!ctx.workdir) throw new Error(`check ${check.kind} needs a workdir`);
  return ctx.workdir;
}

export async function runCheck(check: DeterministicCheck, ctx: CheckContext): Promise<CheckResult> {
  const started = Date.now();
  const done = (passed: boolean, detail: string, logTail?: string): CheckResult => ({
    kind: check.kind,
    passed,
    detail,
    durationMs: Date.now() - started,
    ...(logTail !== undefined ? { logTail } : {}),
  });
  switch (check.kind) {
    case "tests_green":
    case "command": {
      const expected = check.kind === "command" ? check.expectExitCode : 0;
      const timeout = check.kind === "tests_green" ? check.timeoutMs : 600_000;
      const result = await shell(check.command, needWorkdir(check, ctx), timeout, ctx.container);
      if (result.timedOut) return done(false, `\`${check.command}\` timed out after ${timeout} ms`, result.output);
      return done(result.exitCode === expected, `\`${check.command}\` exited ${result.exitCode}`, result.output);
    }
    case "diff_within_paths": {
      const owned = check.paths ?? ctx.state.plan?.ownedPaths ?? [];
      const files = await changedFiles(needWorkdir(check, ctx), ctx.baseBranch);
      if (owned.length === 0) return done(true, `no owned paths declared; ${files.length} files changed`);
      const outside = files.filter((f) => !isOwned(f, owned));
      return outside.length === 0
        ? done(true, `${files.length} changed files within owned paths`)
        : done(false, `files outside owned paths: ${outside.join(", ")}`);
    }
    case "no_uncommitted_changes": {
      const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1"], { cwd: needWorkdir(check, ctx) });
      return stdout.trim() === "" ? done(true, "worktree is clean") : done(false, "uncommitted changes", stdout.trim());
    }
    case "pr_exists":
      return ctx.state.prNumber !== undefined ? done(true, `PR #${ctx.state.prNumber}`) : done(false, "no pull request recorded in run state");
  }
}
