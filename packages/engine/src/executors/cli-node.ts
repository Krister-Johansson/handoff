import { contractRegistry, isContractName, renderContextPacket, type NodeType } from "@handoff/core";
import type { CliExecutor, CliSession } from "@handoff/cli-adapter";
import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";

export type CliNodeOptions = { cli: CliExecutor; maxTurns: number; timeoutMs: number; idleTimeoutMs?: number; model?: string };

const PROMPTS: Partial<Record<NodeType, string>> = {
  planner:
    "Plan the task in the system prompt. Read the repository as needed but do not edit files. Return the plan, the ordered steps and the paths the change will own.",
  coder: "Implement the task in the system prompt in this repository, following the plan in the run state. Commit your work with git when done.",
  reviewer: "Review the changes on this branch against the task and plan. Do not edit files. Return a verdict and line comments.",
};

const RESUME_PROMPT = "Continue the task from where you stopped. When finished, return the structured output required by the output contract.";

/** Planner, Coder and Reviewer: one Claude CLI turn per execution, validated against the node's contract. */
export function cliNodeExecutor(options: CliNodeOptions): NodeExecutor {
  return {
    needsWorkdir: true,
    async execute(ctx: ExecutorContext): Promise<ExecutorOutcome> {
      if (!ctx.workdir) return { kind: "failed", error: { code: "no_workdir", message: "cli nodes need a workdir" } };
      const contractName = ctx.node.contract.output;
      if (!isContractName(contractName)) return { kind: "failed", error: { code: "unknown_contract", message: contractName } };

      const session: CliSession = ctx.execution.executorSessionId
        ? { mode: "resume", id: ctx.execution.executorSessionId }
        : { mode: "new", id: ctx.execution.id, name: `${ctx.run.id.slice(0, 8)}-${ctx.node.key}-${ctx.execution.attempt}` };
      const prompt = session.mode === "resume" ? RESUME_PROMPT : (PROMPTS[ctx.node.type] ?? `Complete the ${ctx.node.type} step described in the system prompt.`);

      const result = await options.cli.run(
        {
          prompt,
          systemPrompt: renderContextPacket(ctx.packet),
          cwd: ctx.workdir.path,
          stagingDir: ctx.stagingDir,
          allowedTools: ctx.packet.constraints.allowedTools,
          maxTurns: ctx.packet.constraints.maxTurns ?? options.maxTurns,
          contract: contractRegistry[contractName],
          addDirs: [],
          session,
          timeoutMs: options.timeoutMs,
          ...(options.idleTimeoutMs ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
          ...(options.model ? { model: options.model } : {}),
        },
        {
          signal: ctx.signal,
          onEvent: (event) => ctx.emit(event.type, event.payload),
          onSessionId: (id) => ctx.setSessionId(id),
        },
      );

      const cost = { usd: result.costUsd, usage: result.usage };
      switch (result.outcome) {
        case "success":
          return {
            kind: "completed",
            output: result.validated,
            cost,
            ...(ctx.node.type === "planner" ? { statePatch: { plan: result.validated } } : {}),
          };
        case "interrupted":
          return { kind: "interrupted" };
        default:
          return {
            kind: "failed",
            error: {
              code: `cli_${result.outcome}`,
              message: result.errorMessage ?? `claude ended with ${result.outcome}`,
              detail: {
                exitCode: result.exitCode,
                stderrTail: result.stderrTail,
                validationIssues: result.validationIssues,
                permissionDenials: result.permissionDenials,
              },
            },
            retryable: result.outcome === "timeout",
          };
      }
    },
  };
}
