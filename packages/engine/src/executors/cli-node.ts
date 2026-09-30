import { contractRegistry, DEFAULT_REVIEW_LEVEL, isContractName, renderContextPacket, type NodeType } from "@handoff/core";
import type { CliExecutor, CliRunOptions, CliRunRequest, CliSession } from "@handoff/cli-adapter";
import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";

/** model and effort are the worker's defaults; a node's config.model and config.effort override them. */
export type CliNodeOptions = { cli: CliExecutor; maxTurns: number; timeoutMs: number; idleTimeoutMs?: number; model?: string; effort?: string };

const PROMPTS: Partial<Record<NodeType, string>> = {
  planner:
    "Plan the task in the system prompt. Read the repository as needed but do not edit files. Return the plan, the ordered steps and the paths the change will own. " +
    "Keep plan to a few sentences on the approach; put the ordered work in steps and do not repeat the steps in plan.",
  coder:
    "Implement the task in the system prompt in this repository, following the plan in the run state. Commit your work with git when done. " +
    "When you finish, fill pr with a title and a description of the change for a reviewer: what changed and why, what you left out, and how you verified it. Do not restate the plan.",
  reviewer:
    "Review the work against the task: the changes on this branch, unless the step's instructions name something else, such as the plan. Do not edit files. " +
    "Return request_changes with one comment per finding that leaves the work wrong or incomplete against the task. " +
    "Approve only when you have no such finding; comments you add to an approval reach the later steps as suggestions.",
};

const modelOf = (ctx: ExecutorContext, options: CliNodeOptions) => (typeof ctx.node.config.model === "string" ? ctx.node.config.model : options.model);
const effortOf = (ctx: ExecutorContext, options: CliNodeOptions) => (typeof ctx.node.config.effort === "string" ? ctx.node.config.effort : options.effort);

/** The first prompt of a session: the role, plus pointers to the step's instructions and to what was sent back. */
/**
 * A code review node runs Claude Code's code-review skill through the Skill tool. Typing the
 * /code-review command as the prompt would run it outside the conversation, with no structured
 * output for routing.
 */
function codeReviewPrompt(ctx: ExecutorContext): string {
  const level = typeof ctx.node.config.level === "string" ? ctx.node.config.level : DEFAULT_REVIEW_LEVEL;
  return [
    `Review this branch's changes against ${ctx.run.baseBranch} with the code-review skill: invoke it with the Skill tool, skill code-review, args "${level} ${ctx.run.branchName}".`,
    "Do not edit files. Then return request_changes with one comment per finding (path, line, body), or approve when it finds nothing.",
  ].join(" ");
}

function firstPrompt(ctx: ExecutorContext): string {
  const role = ctx.node.type === "code_review" ? codeReviewPrompt(ctx) : (PROMPTS[ctx.node.type] ?? `Complete the ${ctx.node.type} step described in the system prompt.`);
  return [
    role,
    ...(ctx.packet.instructions ? ["Follow the instructions for this step in the system prompt."] : []),
    ...(ctx.packet.priorAttempt || ctx.packet.humanAnswer
      ? ["An earlier attempt was sent back: address every point under Previous attempt in the system prompt, and keep what was not questioned."]
      : []),
  ].join(" ");
}

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

const FATAL_API_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed", "billing_error", "account_on_hold"]);
const RATE_LIMIT_TEXT = /rate.?limit|usage limit|\b429\b|overloaded/i;
const FINISH_TURNS = 10;
const FINISH_PROMPT =
  "You ran out of turns. Stop exploring now: commit what is done and return the structured output required by the output contract, with status failed if the work is not finished.";

/** Claude usage-limit messages end with "|<unix seconds>" when the limit resets. */
function retryAfter(text: string): { retryAfterMs?: number } {
  const match = /\|(\d{10})\b/.exec(text);
  if (!match) return {};
  return { retryAfterMs: Math.max(60_000, Number(match[1]) * 1000 - Date.now()) };
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
          : firstPrompt(ctx);

      let mcpProblems: string[] = [];
      let fatalRetryError: string | undefined;
      let rateLimited = false;
      const local = new AbortController();
      const forward = () => local.abort();
      if (ctx.signal.aborted) local.abort();
      ctx.signal.addEventListener("abort", forward, { once: true });
      const base: Omit<CliRunRequest, "prompt" | "session" | "maxTurns"> = {
        systemPrompt: renderContextPacket(ctx.packet),
        cwd: ctx.workdir.path,
        ...(ctx.workdir.container ? { container: ctx.workdir.container } : {}),
        stagingDir: ctx.stagingDir,
        allowedTools: ctx.packet.constraints.allowedTools,
        contract: contractRegistry[contractName],
        addDirs: ctx.library?.addDirs ?? [],
        ...(ctx.library?.mcpConfigPath ? { mcpConfigPath: ctx.library.mcpConfigPath } : {}),
        ...(ctx.library?.agents ? { agents: ctx.library.agents } : {}),
        timeoutMs: options.timeoutMs,
        ...(options.idleTimeoutMs ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
        ...(modelOf(ctx, options) ? { model: modelOf(ctx, options)! } : {}),
        ...(effortOf(ctx, options) ? { effort: effortOf(ctx, options)! } : {}),
      };
      const runOptions: CliRunOptions = {
        signal: local.signal,
        onEvent: (event) => {
          if (event.type === "cli.system.init") mcpProblems = mcpInitProblems(event.payload, ctx.library?.mcpServers ?? []);
          if (event.type === "cli.system.api_retry") {
            const error = (event.payload as { error?: string } | undefined)?.error;
            if (error && FATAL_API_ERRORS.has(error)) {
              fatalRetryError = error;
              local.abort();
            }
            if (error === "rate_limit" || error === "overloaded") rateLimited = true;
          }
          ctx.emit(event.type, event.payload);
        },
        onSessionId: (id) => ctx.setSessionId(id),
        onSpawn: (pid) => ctx.setChildPid(pid),
      };
      let result = await options.cli.run({ ...base, prompt, session, maxTurns: ctx.packet.constraints.maxTurns ?? options.maxTurns }, runOptions);
      if (result.outcome === "error_max_turns" && !local.signal.aborted) {
        // One short resumed turn to wrap up, instead of failing work that is nearly done.
        const id = result.sessionId ?? session.id;
        ctx.emit("node.finishing", { reason: "max_turns" });
        result = await options.cli.run({ ...base, prompt: FINISH_PROMPT, session: { mode: "resume", id }, maxTurns: FINISH_TURNS }, runOptions);
      }
      ctx.signal.removeEventListener("abort", forward);

      if (fatalRetryError) {
        return {
          kind: "failed",
          error: {
            code: "cli_auth_failed",
            message: `Claude rejected the request (${fatalRetryError}). Run \`claude setup-token\` and update CLAUDE_CODE_OAUTH_TOKEN, then repair this node.`,
          },
        };
      }
      const text = `${result.errorMessage ?? ""}\n${result.stderrTail}`;
      if (result.outcome === "error" && (rateLimited || RATE_LIMIT_TEXT.test(text))) {
        return {
          kind: "failed",
          error: { code: "cli_rate_limited", message: result.errorMessage ?? "Claude usage or rate limit reached" },
          retryable: true,
          ...retryAfter(text),
        };
      }
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
