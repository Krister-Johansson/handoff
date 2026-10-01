import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { trackDescendants } from "../processes.ts";
import { parseStreamJson, type StreamJsonLine } from "../stream-json/parser.ts";
import type { CliSession } from "../types.ts";
import { ancestorInstructionExcludes } from "./argv.ts";
import { buildClaudeChatArgv } from "./chat-argv.ts";
import { buildClaudeEnv } from "./env.ts";
import type { ClaudeCliExecutorOptions } from "./executor.ts";

/** One turn of the dashboard's assistant: the person's message and how the CLI may answer it. */
export type ChatTurnRequest = {
  prompt: string;
  /** Written to `<stagingDir>/assistant.md` and appended to the system prompt. */
  systemPrompt: string;
  cwd: string;
  stagingDir: string;
  mcpConfigPath: string;
  allowedTools: string[];
  permissionPromptTool: string;
  maxTurns: number;
  model?: string;
  effort?: string;
  session: CliSession;
  timeoutMs: number;
};

/** What the reply streams: text as it is written, and each tool call with its result. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; content: string; isError: boolean };

export type ChatTurnResult = {
  outcome: "success" | "interrupted" | "timeout" | "error";
  /** The reply's text: the result's when the turn finished, otherwise what streamed so far. */
  text: string;
  sessionId?: string;
  costUsd?: number;
  usage?: unknown;
  errorMessage?: string;
  stderrTail: string;
};

/** API errors no retry fixes: the turn ends at once with what to do. */
const FATAL_API_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed", "billing_error", "account_on_hold"]);
const STDERR_TAIL_LINES = 50;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const blocks = (line: StreamJsonLine) => (Array.isArray(obj(line.message).content) ? (obj(line.message).content as unknown[]).map(obj) : []);

/** A tool result's content as text: a string, or the text of its text blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof obj(c).text === "string" ? (obj(c).text as string) : "")).join("");
  return "";
}

/** The chat events one stream-json line carries. */
function eventsOf(line: StreamJsonLine): ChatEvent[] {
  if (line.type === "stream_event") {
    const event = obj(line.event);
    const delta = obj(event.delta);
    return event.type === "content_block_delta" && delta.type === "text_delta" && typeof delta.text === "string" ? [{ type: "text", text: delta.text }] : [];
  }
  // Subagents' messages carry a parent tool use; the assistant has none, and their text never streams.
  if (line.parent_tool_use_id) return [];
  if (line.type === "assistant") {
    return blocks(line).flatMap((b): ChatEvent[] => (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string" ? [{ type: "tool_call", id: b.id, name: b.name, input: b.input }] : []));
  }
  if (line.type === "user") {
    return blocks(line).flatMap((b): ChatEvent[] =>
      b.type === "tool_result" && typeof b.tool_use_id === "string" ? [{ type: "tool_result", id: b.tool_use_id, content: resultText(b.content), isError: b.is_error === true }] : [],
    );
  }
  return [];
}

/**
 * Runs one turn of the dashboard's assistant with the Claude Code CLI on the subscription: streams the
 * reply's text and tool calls as they happen, and stops the CLI and everything it started on abort or
 * timeout (SIGINT, then SIGTERM, then SIGKILL). A later turn resumes the session the first one started.
 */
export class ClaudeChatRunner {
  constructor(private readonly options: ClaudeCliExecutorOptions) {}

  async run(request: ChatTurnRequest, { signal, onEvent }: { signal: AbortSignal; onEvent: (event: ChatEvent) => void }): Promise<ChatTurnResult> {
    mkdirSync(request.stagingDir, { recursive: true });
    const systemPromptFile = join(request.stagingDir, "assistant.md");
    writeFileSync(systemPromptFile, request.systemPrompt);
    const argv = buildClaudeChatArgv({
      prompt: request.prompt,
      systemPromptFile,
      mcpConfigPath: request.mcpConfigPath,
      allowedTools: request.allowedTools,
      permissionPromptTool: request.permissionPromptTool,
      maxTurns: request.maxTurns,
      claudeMdExcludes: ancestorInstructionExcludes(request.cwd),
      session: request.session,
      ...(request.model ? { model: request.model } : {}),
      ...(request.effort ? { effort: request.effort } : {}),
    });
    const env = buildClaudeEnv({
      oauthToken: this.options.oauthToken,
      configDir: this.options.configDir,
      base: this.options.baseEnv ?? process.env,
      passthrough: this.options.passthroughEnv ?? [],
    });
    const child = spawn(this.options.command.file, [...this.options.command.prefixArgs, ...argv], {
      cwd: request.cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const tracker = child.pid ? trackDescendants(child.pid, this.options.trackIntervalMs) : undefined;
    const stderrTail: string[] = [];
    createInterface({ input: child.stderr }).on("line", (line) => {
      stderrTail.push(line);
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
    });

    let stopReason: "abort" | "timeout" | "fatal" | undefined;
    let fatal: string | undefined;
    const timers: NodeJS.Timeout[] = [];
    const killGroup = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        // already gone
      }
    };
    const stop = (reason: NonNullable<typeof stopReason>) => {
      if (stopReason || child.exitCode !== null) return;
      stopReason = reason;
      const grace = this.options.killGraceMs ?? 10_000;
      killGroup("SIGINT");
      timers.push(setTimeout(() => killGroup("SIGTERM"), grace));
      timers.push(setTimeout(() => killGroup("SIGKILL"), grace * 2));
    };
    const onAbort = () => stop("abort");
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    timers.push(setTimeout(() => stop("timeout"), request.timeoutMs));

    const exited = new Promise<{ code: number | null }>((resolve) => child.on("close", (code) => resolve({ code })));
    const spawnError = new Promise<Error>((resolve) => child.on("error", resolve));
    let streamed = "";
    let sessionId: string | undefined;
    let resultLine: StreamJsonLine | undefined;
    const consume = (async () => {
      for await (const line of parseStreamJson(child.stdout)) {
        const lineSession = "session_id" in line ? line.session_id : undefined;
        if (sessionId === undefined && typeof lineSession === "string") sessionId = lineSession;
        if (line.type === "result") resultLine = line as StreamJsonLine;
        const parsed = line as StreamJsonLine;
        if (parsed.type === "system" && parsed.subtype === "api_retry" && typeof parsed.error === "string" && FATAL_API_ERRORS.has(parsed.error)) {
          fatal = parsed.error;
          stop("fatal");
        }
        for (const event of eventsOf(parsed)) {
          if (event.type === "text") streamed += event.text;
          onEvent(event);
        }
      }
    })();

    const first = await Promise.race([exited.then(() => ({ kind: "exit" as const })), spawnError.then((err) => ({ kind: "error" as const, err }))]);
    await consume.catch(() => {});
    if (first.kind === "exit") await exited;
    signal.removeEventListener("abort", onAbort);
    for (const t of timers) clearTimeout(t);
    await tracker?.stop(this.options.killGraceMs);

    const base = { text: streamed, stderrTail: stderrTail.join("\n"), ...(sessionId ? { sessionId } : {}) };
    if (first.kind === "error") return { ...base, outcome: "error", errorMessage: `failed to start claude: ${first.err.message}` };
    if (stopReason === "fatal") return { ...base, outcome: "error", errorMessage: `Claude rejected the request (${fatal}). Run \`claude setup-token\` and update CLAUDE_CODE_OAUTH_TOKEN.` };
    if (stopReason === "abort") return { ...base, outcome: "interrupted" };
    if (stopReason === "timeout") return { ...base, outcome: "timeout", errorMessage: "The reply took too long and was stopped." };
    if (!resultLine) return { ...base, outcome: "error", errorMessage: "claude exited without a result line" };
    const finished = {
      ...base,
      ...(typeof resultLine.session_id === "string" ? { sessionId: resultLine.session_id } : {}),
      ...(typeof resultLine.total_cost_usd === "number" ? { costUsd: resultLine.total_cost_usd } : {}),
      ...(resultLine.usage !== undefined ? { usage: resultLine.usage } : {}),
      text: typeof resultLine.result === "string" ? resultLine.result : streamed,
    };
    if (resultLine.subtype !== "success" || resultLine.is_error === true) {
      return { ...finished, outcome: "error", errorMessage: typeof resultLine.result === "string" ? resultLine.result : `result ${String(resultLine.subtype)}` };
    }
    return { ...finished, outcome: "success" };
  }
}
