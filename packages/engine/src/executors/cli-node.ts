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

/**
 * When this execution follows a Human gate that answered this node's own needs_input question,
 * resume that conversation instead of starting over. A resumed session keeps its first system
 * prompt, so the answer travels in the prompt.
 */
function answerToResume(ctx: ExecutorContext): { sessionId: string; text: string } | undefined {
  const trigger = ctx.execution.trigger;
  if (trigger?.kind !== "edge" || !trigger.from) return undefined;
  const answer = ctx.state.human[trigger.from];
  const previous = ctx.state.nodes[ctx.node.key];
  const asked = (previous?.output as { status?: string } | undefined)?.status === "needs_input";
  if (!answer || !asked || !previous?.sessionId) return undefined;
  return { sessionId: previous.sessionId, text: answer.option ? `${answer.option}: ${answer.answer}` : answer.answer };
}

/** Names of required MCP servers that the CLI reported as failed, missing or skipped at init. */
function mcpInitProblems(payload: unknown, required: string[]): string[] {
  const init = (payload ?? {}) as { mcp_servers?: { name: string; status: string }[]; mcp_server_errors?: { name: string; message?: string }[] };
  const problems = (init.mcp_server_errors ?? []).map((e) => `${e.name} (${e.message ?? "invalid config"})`);
  for (const name of required) {
    const server = init.mcp_servers?.find((s) => s.name === name);
    if (!server) {
      if (!problems.some((p) => p.startsWith(name))) problems.push(`${name} (not loaded)`);
    } else if (server.status === "failed" || server.status === "needs-auth") problems.push(`${name} (${server.status})`);
  }
  return problems;
}

const RESUME_PROMPT = "Continue the task from where you stopped. When finished, return the structured output required by the output contract.";

/** Planner, Coder and Reviewer: one Claude CLI turn per execution, validated against the node's contract. */
export function cliNodeExecutor(options: CliNodeOptions): NodeExecutor {
  return {
    needsWorkdir: true,
    async execute(ctx: ExecutorContext): Promise<ExecutorOutcome> {
      if (!ctx.workdir) return { kind: "failed", error: { code: "no_workdir", message: "cli nodes need a workdir" } };
      const contractName = ctx.node.contract.output;
      if (!isContractName(contractName)) return { kind: "failed", error: { code: "unknown_contract", message: contractName } };

      const answer = answerToResume(ctx);
      const session: CliSession = ctx.execution.executorSessionId
        ? { mode: "resume", id: ctx.execution.executorSessionId }
        : answer
          ? { mode: "resume", id: answer.sessionId }
          : { mode: "new", id: ctx.execution.id, name: `${ctx.run.id.slice(0, 8)}-${ctx.node.key}-${ctx.execution.attempt}` };
      const prompt = ctx.execution.executorSessionId
        ? RESUME_PROMPT
        : answer
          ? `A person answered your question: "${answer.text}". Continue the task with that answer. When finished, return the structured output required by the output contract.`
          : (PROMPTS[ctx.node.type] ?? `Complete the ${ctx.node.type} step described in the system prompt.`);

      let mcpProblems: string[] = [];
      const result = await options.cli.run(
        {
          prompt,
          systemPrompt: renderContextPacket(ctx.packet),
          cwd: ctx.workdir.path,
          stagingDir: ctx.stagingDir,
          allowedTools: ctx.packet.constraints.allowedTools,
          maxTurns: ctx.packet.constraints.maxTurns ?? options.maxTurns,
          contract: contractRegistry[contractName],
          addDirs: ctx.library?.addDirs ?? [],
          ...(ctx.library?.mcpConfigPath ? { mcpConfigPath: ctx.library.mcpConfigPath } : {}),
          ...(ctx.library?.agents ? { agents: ctx.library.agents } : {}),
          session,
          timeoutMs: options.timeoutMs,
          ...(options.idleTimeoutMs ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
          ...(options.model ? { model: options.model } : {}),
        },
        {
          signal: ctx.signal,
          onEvent: (event) => {
            if (event.type === "cli.system.init") mcpProblems = mcpInitProblems(event.payload, ctx.library?.mcpServers ?? []);
            ctx.emit(event.type, event.payload);
          },
          onSessionId: (id) => ctx.setSessionId(id),
        },
      );

      const cost = { usd: result.costUsd, usage: result.usage };
      if (mcpProblems.length && result.outcome !== "interrupted") {
        return { kind: "failed", error: { code: "mcp_unavailable", message: `MCP servers did not start: ${mcpProblems.join(", ")}` } };
      }
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
