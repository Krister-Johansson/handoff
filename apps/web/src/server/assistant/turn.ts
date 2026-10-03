import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatEvent, ChatTurnRequest, ChatTurnResult } from "@handoff/cli-adapter";
import type { AssistantCall, Db } from "@handoff/db";
import type { GitHubPort } from "@handoff/github";
import { CATALOG, withChatProject, type ChatProject, type ToolSpec } from "../../lib/assistant/catalog";
import { pageSpecsOf, pageToolSpec, type PageDescriptor, type PageToolSpec } from "../../lib/assistant/page-tools";
import { claimProject, conversationProject, getConversation, setConversationSession, storeMessage } from "./conversations";
import { SYSTEM_PROMPT, turnPrompt } from "./prompt";
import type { AssistantConfig } from "./env";
import { closeTurn, openTurn, type LiveTurn } from "./relay";
import { APPROVE_TOOL, TOOL_PREFIX } from "./turn-mcp";

/** Runs one turn of the CLI: the Claude Code chat runner, or a fake in tests. */
export type ChatRunnerLike = { run(request: ChatTurnRequest, options: { signal: AbortSignal; onEvent: (event: ChatEvent) => void }): Promise<ChatTurnResult> };

export type TurnDeps = { db: Db; github: GitHubPort | undefined; runner: ChatRunnerLike; config: AssistantConfig; baseUrl: string };

const SPECS = new Map(CATALOG.map((t) => [t.name, t]));

/**
 * The read tools and the UI tools: they run without asking. Every other tool goes through the approval
 * card. A turn on a page adds the page's tools that need no card: view changes and drafts the person sees.
 */
const READ_TOOLS = CATALOG.filter((t) => t.readOnly && !t.confirm).map((t) => `${TOOL_PREFIX}${t.name}`);


/**
 * A tool call as the panel shows it: its catalog or page tool title and one-line summary, and its
 * arguments with the chat's project where the call left it out, as the tool ran them.
 */
function describeCall(name: string, given: unknown, project: ChatProject | undefined) {
  const bare = name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : undefined;
  const spec: ToolSpec | PageToolSpec | undefined = bare === undefined ? undefined : (SPECS.get(bare) ?? pageToolSpec(bare));
  if (!spec) return { name, title: name, summary: name, args: given };
  const args = withChatProject(spec, given, project);
  const parsed = spec.input.safeParse(args);
  return { name: spec.name, title: spec.title, summary: parsed.success ? spec.summarize(parsed.data) : spec.title, args };
}

/**
 * Starts a turn of a conversation: stores the person's message, gives the turn a token and an MCP
 * config for handoff's tools, runs the CLI (resuming the conversation's session after the first turn),
 * streams what happens to the turn's events, then stores the reply with its tool calls and approvals.
 * The staging folder and the token are gone when the turn ends. `done` settles when it is stored.
 */
export async function startTurn(deps: TurnDeps, conversationId: string, input: { text: string; source: string; page?: PageDescriptor }): Promise<LiveTurn & { done: Promise<void> }> {
  const conversation = await getConversation(deps.db, conversationId);
  if (!conversation) throw new Error(`There is no conversation ${conversationId}.`);
  // A chat started outside a project takes the project of the first page a later message names.
  if (!conversation.projectId && input.page) await claimProject(deps.db, conversationId, input.page.path);
  // A chat on a project names it to the model, and its tools use it when a call leaves the project out.
  const project = await conversationProject(deps.db, conversationId);
  const turn = openTurn(conversationId, input.page, project);
  await storeMessage(deps.db, {
    conversationId,
    turnId: turn.id,
    role: "user",
    content: { text: input.text, source: input.source, ...(input.page ? { page: { kind: input.page.kind, path: input.page.path } } : {}) },
  });

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
      const described = describeCall(event.name, event.input, project);
      calls.push({ id: event.id, name: event.name.replace(TOOL_PREFIX, ""), args: described.args });
      return turn.emit({ type: "tool_call", id: event.id, ...described });
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
          prompt: turnPrompt(input.text, input.source, input.page, project),
          systemPrompt: SYSTEM_PROMPT,
          cwd,
          stagingDir: staging,
          mcpConfigPath,
          allowedTools: [...READ_TOOLS, ...pageSpecsOf(input.page).filter((t) => !t.confirm).map((t) => `${TOOL_PREFIX}${t.name}`)],
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
