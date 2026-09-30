import { shell } from "../contract/checks.ts";
import type { ExecutorOutcome, NodeExecutor } from "../types.ts";

/** Runs the node's command in the run worktree. A failing command is a result, not an error: routing decides. */
export function testerExecutor(): NodeExecutor {
  return {
    needsWorkdir: true,
    async execute(ctx): Promise<ExecutorOutcome> {
      const command = ctx.node.config.command;
      if (typeof command !== "string" || command.trim() === "") {
        return { kind: "failed", error: { code: "no_command", message: `tester node ${ctx.node.key} has no config.command` } };
      }
      if (!ctx.workdir) return { kind: "failed", error: { code: "no_workdir", message: "tester needs the run worktree" } };
      const timeoutMs = typeof ctx.node.config.timeoutMs === "number" ? ctx.node.config.timeoutMs : 10 * 60_000;
      ctx.emit("shell.started", { command });
      const result = await shell(command, ctx.workdir.path, timeoutMs, ctx.workdir.container);
      const output = { passed: result.exitCode === 0 && !result.timedOut, command, exitCode: result.exitCode, tail: result.output };
      ctx.emit("shell.finished", { command, exitCode: result.exitCode, timedOut: result.timedOut });
      return { kind: "completed", output, statePatch: { testResults: output } };
    },
  };
}
