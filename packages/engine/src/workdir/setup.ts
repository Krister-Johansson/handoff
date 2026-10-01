import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { shell } from "../contract/checks.ts";
import type { Workdir } from "../types.ts";

const execFileAsync = promisify(execFile);
const SETUP_TIMEOUT_MS = 20 * 60_000;

/** A project's setup command failed, so the step that needed the worktree cannot start. */
export class SetupFailedError extends Error {}

/** Where the worktree remembers which setup command already ran: its own git directory, outside the tree. */
async function markerOf(workdir: Workdir): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: workdir.path });
  const gitDir = stdout.trim();
  return join(isAbsolute(gitDir) ? gitDir : join(workdir.path, gitDir), "handoff-setup");
}

/**
 * Runs the project's setup command (installing dependencies, for example) in a run's worktree the
 * first time a step uses it, and again only when the command changes. Throws SetupFailedError with
 * the command's output when it fails.
 */
export async function setUpWorkdir(workdir: Workdir, command: string, emit: (type: string, payload: unknown) => void, signal?: AbortSignal): Promise<void> {
  const marker = await markerOf(workdir);
  const hash = createHash("sha256").update(command).digest("hex");
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === hash) return;
  emit("setup.started", { command });
  const result = await shell(command, workdir.path, SETUP_TIMEOUT_MS, workdir.container, [], signal);
  emit("setup.finished", { command, exitCode: result.exitCode, timedOut: result.timedOut });
  if (result.exitCode !== 0 || result.timedOut) {
    const why = result.timedOut ? "timed out" : `exited ${result.exitCode}`;
    throw new SetupFailedError(`The project's setup command \`${command}\` ${why}:\n${result.output}`);
  }
  writeFileSync(marker, hash);
}
