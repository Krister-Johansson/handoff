import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { brief, contractRegistry, DEFAULT_REVIEW_LEVEL, describePermission, isContractName, renderContextPacket, runPath, type NodeType } from "@handoff/core";
import type { Db } from "@handoff/db";
import { PERMISSION_TIMEOUT_MS, PERMISSION_TOOL, permissionServer, watchPermissions, type PermissionWatch } from "../permissions/broker.ts";
import type { CliExecutor, CliRunOptions, CliRunRequest, CliRunResult, CliSession } from "@handoff/cli-adapter";
import type { ExecutorContext, ExecutorOutcome, NodeExecutor } from "../types.ts";

/**
 * model and effort are the worker's defaults; a node's config.model and config.effort override them.
 * With `permissions`, a tool call the step's allow rules do not cover waits for a person to allow or
 * deny it (up to `timeoutMs`), instead of being denied at once.
 */
export type CliNodeOptions = {
  cli: CliExecutor;
  maxTurns: number;
  timeoutMs: number;
  idleTimeoutMs?: number;
  model?: string;
  effort?: string;
  permissions?: { db: Db; timeoutMs?: number };
};

const PROMPTS: Partial<Record<NodeType, string>> = {
  planner:
    "Plan the task in the system prompt. Read the repository as needed but do not edit files. Return the plan, the ordered steps and the paths the change will own. " +
    "Keep plan to a few sentences on the approach; put the ordered work in steps and do not repeat the steps in plan. " +
    "ownedPaths is the whole list of files and directories the change may touch: a plan has no extra paths, so include every file the steps need, such as lockfiles next to a package.json you change. " +
    "When the linked issues list no acceptance criteria, list in acceptance what a person can check in the running app to see the task is done, one plain sentence each, such as \"A user can create a new task\".",
  coder:
    "Implement the task in the system prompt in this repository, following the plan in the run state. Commit your work with git when done. " +
    "When you finish, fill pr with a title and a description of the change for a reviewer: what changed and why, what you left out, and how you verified it. Do not restate the plan.",
  demo:
    "Walk through the running app described in the system prompt with the playwright tools, as a person checking the acceptance criteria would. " +
    "Take a screenshot that shows each criterion, and report each one in shots. Do not edit files.",
  reviewer:
    "Review the work against the task: the changes on this branch, unless the step's instructions name something else, such as the plan. Do not edit files. " +
    "Return request_changes with one comment per finding that leaves the work wrong or incomplete against the task. " +
    "Approve only when you have no such finding; comments you add to an approval reach the later steps as suggestions.",
};

const execFileAsync = promisify(execFile);

/** The commit the worktree is on, or undefined when it is not a git checkout. */
async function headOf(cwd: string): Promise<string | undefined> {
  try {
    return (await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd })).stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

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
    "Do not edit files. Then return request_changes only for a finding that makes the change wrong, insecure, or misses the task, with one comment per such finding (path, line, body). " +
      "Approve otherwise, and put every other finding as a comment on the approval: those reach the later steps and the pull request as suggestions.",
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
    ...(ctx.packet.previousReview
      ? ["You reviewed this work before: follow Your previous review in the system prompt, checking your earlier comments and only what changed since."]
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

/** The text of an assistant message on the stream, or undefined when it has none (only tool calls). */
function textOf(payload: unknown): string | undefined {
  const content = (payload as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .flatMap((part) => ((part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : []))
    .join("\n")
    .trim();
  return text || undefined;
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

      const reviewedAt = ctx.node.type === "reviewer" || ctx.node.type === "code_review" ? await headOf(ctx.workdir.path) : undefined;
      let mcpProblems: string[] = [];
      let fatalRetryError: string | undefined;
      let rateLimited = false;
      let lastMessage: string | undefined;
      const local = new AbortController();
      const forward = () => local.abort();
      if (ctx.signal.aborted) local.abort();
      ctx.signal.addEventListener("abort", forward, { once: true });
      // A person answers permission requests through handoff's permission server, next to the library's MCP servers.
      // Not in a Docker workspace: the server runs on the host, where the container's Claude Code cannot start it.
      let mcpConfigPath = ctx.library?.mcpConfigPath;
      let requiredServers = ctx.library?.mcpServers ?? [];
      let permissionWatch: PermissionWatch | undefined;
      if (options.permissions && !ctx.workdir.container) {
        const dir = join(ctx.stagingDir, "permissions");
        const servers = mcpConfigPath ? (JSON.parse(readFileSync(mcpConfigPath, "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers : {};
        mcpConfigPath = join(ctx.stagingDir, "mcp-permissions.json");
        writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { ...servers, handoff: permissionServer(dir, options.permissions.timeoutMs ?? PERMISSION_TIMEOUT_MS) } }, null, 2), { mode: 0o600 });
        requiredServers = [...requiredServers, "handoff"];
        permissionWatch = watchPermissions(options.permissions.db, {
          runId: ctx.run.id,
          executionId: ctx.execution.id,
          dir,
          onRequest: async (request) => {
            ctx.emit("permission.requested", request);
            const { action, detail } = describePermission(request.toolName, request.input);
            await ctx.notify("permission", { title: `${ctx.project.name}: ${ctx.node.key} ${action}`, body: brief(detail || ctx.run.task), href: runPath(ctx.project.id, ctx.run.id) });
          },
        });
      }
      const base: Omit<CliRunRequest, "prompt" | "session" | "maxTurns"> = {
        systemPrompt: renderContextPacket(ctx.packet),
        cwd: ctx.workdir.path,
        ...(ctx.workdir.container ? { container: ctx.workdir.container } : {}),
        stagingDir: ctx.stagingDir,
        allowedTools: ctx.packet.constraints.allowedTools,
        contract: contractRegistry[contractName],
        addDirs: ctx.library?.addDirs ?? [],
        ...(mcpConfigPath ? { mcpConfigPath } : {}),
        ...(permissionWatch ? { permissionPromptTool: PERMISSION_TOOL } : {}),
        ...(ctx.library?.agents ? { agents: ctx.library.agents } : {}),
        timeoutMs: options.timeoutMs,
        ...(options.idleTimeoutMs ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
        ...(modelOf(ctx, options) ? { model: modelOf(ctx, options)! } : {}),
        ...(effortOf(ctx, options) ? { effort: effortOf(ctx, options)! } : {}),
      };
      const runOptions: CliRunOptions = {
        signal: local.signal,
        onEvent: (event) => {
          if (event.type === "cli.system.init") mcpProblems = mcpInitProblems(event.payload, requiredServers);
          if (event.type === "cli.assistant") lastMessage = textOf(event.payload) ?? lastMessage;
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
        holdIdle: () => permissionWatch?.waiting() ?? false,
      };
      let result;
      // Turns and cost over every claude run of this execution, the wrap-up turn included.
      let turns: number | undefined;
      let spent: number | undefined;
      const count = (r: CliRunResult) => {
        if (r.numTurns !== undefined) turns = (turns ?? 0) + r.numTurns;
        if (r.costUsd !== undefined) spent = (spent ?? 0) + r.costUsd;
      };
      try {
        result = await options.cli.run({ ...base, prompt, session, maxTurns: ctx.packet.constraints.maxTurns ?? options.maxTurns }, runOptions);
        count(result);
        if (result.outcome === "error_max_turns" && !local.signal.aborted) {
          // One short resumed turn to wrap up, instead of failing work that is nearly done.
          const id = result.sessionId ?? session.id;
          ctx.emit("node.finishing", { reason: "max_turns" });
          result = await options.cli.run({ ...base, prompt: FINISH_PROMPT, session: { mode: "resume", id }, maxTurns: FINISH_TURNS }, runOptions);
          count(result);
        }
      } finally {
        await permissionWatch?.stop();
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
            // A planner's question is not a plan: the run keeps no plan until the answer comes back.
            ...(ctx.node.type === "planner" && (result.validated as { status?: string }).status !== "needs_input" ? { statePatch: { plan: result.validated } } : {}),
            // A review remembers the commit it looked at, so its next round can look only at what changed since.
            ...(reviewedAt ? { statePatch: { reviewedAt: { ...(ctx.state.reviewedAt as Record<string, string> | undefined), [ctx.node.key]: reviewedAt } } } : {}),
          };
        case "interrupted":
          return { kind: "interrupted" };
        default:
          return {
            kind: "failed",
            error: {
              code: `cli_${result.outcome}`,
              message: result.errorMessage ?? `claude ended with ${result.outcome}`,
              // Why it stopped, as a person reads it: how it ended, how far it got, what it cost and what it said last.
              detail: {
                subtype: result.outcome,
                ...(turns !== undefined ? { turns } : {}),
                ...(spent !== undefined ? { costUsd: spent } : {}),
                ...(lastMessage ? { lastMessage } : {}),
                exitCode: result.exitCode,
                stderrTail: result.stderrTail,
                validationIssues: result.validationIssues,
                permissionDenials: result.permissionDenials,
              },
            },
            ...(spent !== undefined ? { cost: { usd: spent, usage: result.usage } } : {}),
            retryable: result.outcome === "timeout",
          };
      }
    },
  };
}
