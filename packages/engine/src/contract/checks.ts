import { execFile, spawn } from "node:child_process";
import { matchesGlob } from "node:path";
import { promisify } from "node:util";
import { trackDescendants } from "@handoff/cli-adapter";
import { extraPathsOf, memoryOf, passEnvProblem, pickEnv, redactSecrets, type CheckResult, type DeterministicCheck, type RunState } from "@handoff/core";

const execFileAsync = promisify(execFile);
const TAIL_LINES = 200;

/** What a check may look at; `output` is the node's own output being checked, `nodeKey` the node that wrote it. */
export type CheckContext = { state: RunState; baseBranch: string; workdir?: string | undefined; container?: string | undefined; output?: unknown; nodeKey?: string | undefined };

const COMMAND_ENV_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TERM"];

/**
 * Tester commands and command checks run code the agent wrote, so they get a minimal environment:
 * never the worker's GITHUB_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, webhook secret or DATABASE_URL.
 */
export function commandEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = { CI: "true" };
  for (const key of COMMAND_ENV_KEYS) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Runs a shell command in the worktree, or inside the run's container when one is given. The command
 * gets its own process group, so a timeout or an abort stops everything it started, and whatever it
 * left running in the background is stopped when it ends.
 */
export async function shell(
  command: string,
  cwd: string,
  timeoutMs: number,
  container?: string,
  passEnv: readonly string[] = [],
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
  const problem = passEnvProblem(passEnv);
  if (problem) throw new Error(problem);
  const passed = pickEnv(passEnv, process.env);
  return new Promise((resolve) => {
    // docker exec -e NAME reads the value from the docker client's environment, so values stay out of argv.
    const child = container
      ? spawn("docker", ["exec", "-e", "CI=true", ...Object.keys(passed).flatMap((name) => ["-e", name]), "-w", cwd, container, "sh", "-c", command], {
          env: { ...process.env, ...passed },
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        })
      : spawn("sh", ["-c", command], { cwd, env: { ...commandEnv(), ...passed } as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const tracker = child.pid && !container ? trackDescendants(child.pid, 500) : undefined;
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    };
    const lines: string[] = [];
    // One partial-line buffer per stream, so a chunk boundary never splits or blanks a line.
    const partial = { stdout: "", stderr: "" };
    const collect = (stream: keyof typeof partial) => (chunk: Buffer) => {
      const parts = (partial[stream] + chunk.toString("utf8")).split("\n");
      partial[stream] = parts.pop() ?? "";
      lines.push(...parts);
      if (lines.length > TAIL_LINES * 2) lines.splice(0, lines.length - TAIL_LINES);
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    const onAbort = () => killGroup();
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    // "exit", not "close": a background process can hold the pipes open long after the shell is gone.
    child.on("exit", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const closed = new Promise((r) => child.once("close", r));
      void (tracker?.stop(500) ?? Promise.resolve())
        .then(() => killGroup())
        // With nothing left holding them, the pipes close and the last output arrives.
        .then(() => Promise.race([closed, new Promise((r) => setTimeout(r, 1_000))]))
        .then(() => {
          for (const rest of [partial.stdout, partial.stderr]) if (rest) lines.push(rest);
          resolve({ exitCode: code, output: redactSecrets(lines.slice(-TAIL_LINES).join("\n").trim()), timedOut });
        });
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
      const result = await shell(check.command, needWorkdir(check, ctx), timeout, ctx.container, check.passEnv);
      if (result.timedOut) return done(false, `\`${check.command}\` timed out after ${timeout} ms`, result.output);
      return done(result.exitCode === expected, `\`${check.command}\` exited ${result.exitCode}`, result.output);
    }
    case "diff_within_paths": {
      const owned = check.paths ?? ctx.state.plan?.ownedPaths ?? [];
      const files = await changedFiles(needWorkdir(check, ctx), ctx.baseBranch);
      if (owned.length === 0) return done(true, `no owned paths declared; ${files.length} files changed`);
      // Paths an earlier attempt of this node declared stay allowed: the branch still has them.
      const remembered = ctx.nodeKey ? memoryOf(ctx.state, ctx.nodeKey).extraPaths : [];
      const allowed = [...owned, ...[...remembered, ...extraPathsOf(ctx.output)].map((e) => e.path)];
      const outside = files.filter((f) => !isOwned(f, allowed));
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
