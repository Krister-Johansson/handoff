import { passEnvProblem } from "@handoff/core";
import { shell } from "../contract/checks.ts";
import type { ExecutorOutcome, NodeExecutor } from "../types.ts";
import { runIdentity } from "../workdir/setup.ts";

const NOTE_TAIL_LINES = 20;

/**
 * Runs the node's command in the run worktree. A failing command is a result, not an error: routing
 * decides. A failing command runs again `config.retries` times (default 1), and a pass on a retry
 * passes with a note that names the earlier failure. A command the shell does not find fails the step
 * instead, with its exit code and last output lines, since the coder cannot fix the worktree's setup.
 */
export function testerExecutor(): NodeExecutor {
  return {
    needsWorkdir: true,
    async execute(ctx): Promise<ExecutorOutcome> {
      const command = ctx.node.config.command;
      if (typeof command !== "string" || command.trim() === "") {
        return { kind: "failed", error: { code: "no_command", message: `tester node ${ctx.node.key} has no config.command` } };
      }
      if (!ctx.workdir) return { kind: "failed", error: { code: "no_workdir", message: "tester needs the run worktree" } };
      const workdir = ctx.workdir;
      const timeoutMs = typeof ctx.node.config.timeoutMs === "number" ? ctx.node.config.timeoutMs : 10 * 60_000;
      const retries = typeof ctx.node.config.retries === "number" ? Math.max(0, Math.floor(ctx.node.config.retries)) : 1;
      const passEnv = ctx.node.config.passEnv ?? [];
      const problem = passEnvProblem(passEnv);
      if (problem) return { kind: "failed", error: { code: "invalid_pass_env", message: problem } };
      const env = runIdentity(ctx.run.id, workdir.path);
      const once = async () => {
        ctx.emit("shell.started", { command });
        const result = await shell(command, workdir.path, timeoutMs, workdir.container, passEnv as string[], ctx.signal, env);
        ctx.emit("shell.finished", { command, exitCode: result.exitCode, timedOut: result.timedOut });
        return { ...result, passed: result.exitCode === 0 && !result.timedOut };
      };

      let result = await once();
      const failures: typeof result[] = [];
      while (!result.passed && !environmentFailure(result) && failures.length < retries && !ctx.signal.aborted) {
        failures.push(result);
        result = await once();
      }
      if (!result.passed && environmentFailure(result)) {
        const message =
          `\`${command}\` could not run its tests (exit ${result.exitCode}): the shell did not find a command it runs. ` +
          "The worktree's environment needs fixing, such as the project's setup command, so the step fails instead of sending the work back to the coder. " +
          `Its last output:\n${tailOf(result.output)}`;
        return { kind: "failed", error: { code: "tester_environment", message, detail: { exitCode: result.exitCode, tail: result.output } } };
      }
      const output = { passed: result.passed, command, exitCode: result.exitCode, tail: result.output };
      if (result.passed && failures.length) Object.assign(output, { note: retryNote(failures) });
      return { kind: "completed", output, statePatch: { testResults: output } };
    },
  };
}

/** A test runner's report of a failing test: vitest, jest, mocha, node:test, TAP, pytest. */
const TEST_FAILURE = /\bFAIL\b|✗|×|AssertionError|\bnot ok \d|\b\d+ (?:tests? )?failed\b|\b\d+ failing\b|\bFAILED\b/;
/** The shell's own report of a command it did not find: `sh: 1: x: not found` (dash), `sh: x: command not found` (bash). */
const SHELL_NOT_FOUND = /^(?:\S*\/)?(?:ba|da)?sh: (?:line )?(?:\d+: )?[^\s:]+: (?:command )?not found$/m;

/**
 * The command could not run the tests at all: the shell did not find a command it runs (exit 127, or
 * the shell's not-found line when a script turned that into another exit code). Anything else, such as
 * a runner that stops on a missing env variable, is a test failure the coder sees with its output.
 */
function environmentFailure(result: { exitCode: number | null; timedOut: boolean; output: string }): boolean {
  if (result.timedOut || TEST_FAILURE.test(result.output)) return false;
  return result.exitCode === 127 || SHELL_NOT_FOUND.test(result.output);
}

/** Says that the command passed only on a retry, with how the earlier runs failed. */
function retryNote(failures: { exitCode: number | null; timedOut: boolean; output: string }[]): string {
  const first = failures[0]!;
  const why = first.timedOut ? "timed out" : `exited ${first.exitCode}`;
  const runs = failures.length === 1 ? "The first run" : `The first ${failures.length} runs`;
  return `${runs} failed (${why}) and a retry passed, so a test may be flaky. The first run's output:\n${tailOf(first.output)}`;
}

/** The last lines of a command's output, short enough for a message or a note. */
function tailOf(output: string): string {
  return output.split("\n").slice(-NOTE_TAIL_LINES).join("\n");
}
