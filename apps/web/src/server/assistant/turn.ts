import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatEvent, ChatTurnRequest, ChatTurnResult } from "@handoff/cli-adapter";
import type { AssistantCall, Db } from "@handoff/db";
import type { GitHubPort } from "@handoff/github";
import { CATALOG } from "../../lib/assistant/catalog";
import { getConversation, setConversationSession, storeMessage } from "./conversations";
import { systemPromptFor } from "./prompt";
import type { AssistantConfig } from "./env";
import { closeTurn, openTurn, type LiveTurn } from "./relay";
import { APPROVE_TOOL, TOOL_PREFIX } from "./turn-mcp";

/** Runs one turn of the CLI: the Claude Code chat runner, or a fake in tests. */
export type ChatRunnerLike = { run(request: ChatTurnRequest, options: { signal: AbortSignal; onEvent: (event: ChatEvent) => void }): Promise<ChatTurnResult> };

export type TurnDeps = { db: Db; github: GitHubPort | undefined; runner: ChatRunnerLike; config: AssistantConfig; baseUrl: string };

const SPECS = new Map(CATALOG.map((t) => [t.name, t]));

/** The read tools and the UI tools: they run without asking. Every other tool goes through the approval card. */
const READ_TOOLS = CATALOG.filter((t) => t.readOnly && !t.confirm).map((t) => `${TOOL_PREFIX}${t.name}`);


/** A tool call as the panel shows it: its catalog title and one-line summary. */
function describeCall(name: string, args: unknown) {
  const spec = name.startsWith(TOOL_PREFIX) ? SPECS.get(name.slice(TOOL_PREFIX.length)) : undefined;
  if (!spec) return { name, title: name, summary: name };
  const parsed = spec.input.safeParse(args);
  return { name: spec.name, title: spec.title, summary: parsed.success ? spec.summarize(parsed.data) : spec.title };
}

/**
 * Starts a turn of a conversation: stores the person's message, gives the turn a token and an MCP
 * config for handoff's tools, runs the CLI (resuming the conversation's session after the first turn),
 * streams what happens to the turn's events, then stores the reply with its tool calls and approvals.
 * The staging folder and the token are gone when the turn ends. `done` settles when it is stored.
 */
export async function startTurn(deps: TurnDeps, conversationId: string, input: { text: string; source: string }): Promise<LiveTurn & { done: Promise<void> }> {
  const conversation = await getConversation(deps.db, conversationId);
  if (!conversation) throw new Error(`There is no conversation ${conversationId}.`);
  const turn = openTurn(conversationId);
  await storeMessage(deps.db, { conversationId, turnId: turn.id, role: "user", content: { text: input.text, source: input.source } });

  const staging = join(deps.config.home, "turns", turn.id);
  const cwd = join(deps.config.home, "cwd");
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  mkdirSync(cwd, { recursive: true });
  const mcpConfigPath = join(staging, "mcp.json");
  writeFileSync(
    mcpConfigPath,
    JSON.stringify({ mcpServers: { handoff: { type: "http", url: `${deps.baseUrl}/api/assistant/mcp`, headers: { Authorization: `Bearer ${turn.token}` } } } }),
    { mode: 0o600 },
  );
  chmodSync(mcpConfigPath, 0o600);

  const calls: AssistantCall[] = [];
  const onEvent = (event: ChatEvent) => {
    if (event.type === "text") return turn.emit({ type: "text", text: event.text });
    if (event.type === "tool_call") {
      // Asking the person is Claude Code's permission prompt, not a call of its own.
      if (event.name === APPROVE_TOOL) return;
      calls.push({ id: event.id, name: event.name.replace(TOOL_PREFIX, ""), args: event.input });
      return turn.emit({ type: "tool_call", id: event.id, args: event.input, ...describeCall(event.name, event.input) });
    }
    const call = calls.find((c) => c.id === event.id);
    if (call) Object.assign(call, { result: event.content, isError: event.isError });
    turn.emit({ type: "tool_result", id: event.id, result: event.content, isError: event.isError });
  };

  const session = conversation.cliSessionId
    ? ({ mode: "resume", id: conversation.cliSessionId } as const)
    : ({ mode: "new", id: randomUUID(), name: `assistant-${conversationId.slice(0, 8)}` } as const);

  const finishTurn = async () => {
    let result: ChatTurnResult;
    try {
      result = await deps.runner.run(
        {
          prompt: input.text.trimStart().startsWith("-") ? ` ${input.text}` : input.text,
          systemPrompt: systemPromptFor(input.source),
          cwd,
          stagingDir: staging,
          mcpConfigPath,
          allowedTools: READ_TOOLS,
          permissionPromptTool: APPROVE_TOOL,
          maxTurns: deps.config.maxTurns,
          model: deps.config.model,
          effort: deps.config.effort,
          session,
          timeoutMs: deps.config.turnTimeoutMs,
        },
        { signal: turn.controller.signal, onEvent },
      );
    } catch (error) {
      result = { outcome: "error", text: "", errorMessage: (error as Error).message, stderrTail: "" };
    }
    for (const call of calls) {
      const approval = turn.approvals.get(call.id);
      if (approval) call.approval = { approved: approval.approved, at: approval.at, ...(approval.note ? { note: approval.note } : {}) };
    }
    const outcome = result.outcome === "success" ? "done" : result.outcome === "interrupted" ? "interrupted" : "error";
    const error = outcome === "error" ? (result.errorMessage ?? "The reply failed.") : undefined;
    await storeMessage(deps.db, {
      conversationId,
      turnId: turn.id,
      role: "assistant",
      content: {
        text: result.text,
        calls,
        outcome,
        ...(error ? { error } : {}),
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        ...(result.usage !== undefined ? { usage: result.usage } : {}),
      },
    });
    await setConversationSession(deps.db, conversationId, { cliSessionId: session.mode === "new" ? result.sessionId : undefined, model: result.model });
    if (outcome === "done") turn.emit({ type: "done", text: result.text, ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}) });
    else if (outcome === "interrupted") turn.emit({ type: "interrupted", text: result.text });
    else turn.emit({ type: "error", message: error! });
  };
  const done = (async () => {
    try {
      await finishTurn();
    } finally {
      // Whatever happened, the token stops working and the staging folder (with its mcp.json) is removed.
      rmSync(staging, { recursive: true, force: true });
      closeTurn(turn);
    }
  })();
  return Object.assign(turn, { done });
}

/** Stops a running turn: its open approvals are denied and the CLI is interrupted. */
export function stopTurn(turn: LiveTurn) {
  turn.denyAll("The person stopped the turn.");
  turn.controller.abort();
}
