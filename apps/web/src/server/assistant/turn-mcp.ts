import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { annotationsOf, CATALOG, forChatProject, withChatProject, type ToolSpec } from "../../lib/assistant/catalog";
import { pageSpecsOf, type PageToolSpec } from "../../lib/assistant/page-tools";
import { registerDataTools, type HandoffMcpDeps } from "../agent-mcp";
import { planViewRefusal } from "../plan-mode";
import { turnByToken, type LiveTurn } from "./relay";

/** The prefix Claude Code gives the tools of the "handoff" MCP server. */
export const TOOL_PREFIX = "mcp__handoff__";
/** The permission prompt tool the assistant's turns name: Claude Code asks it before any tool outside --allowedTools. */
export const APPROVE_TOOL = `${TOOL_PREFIX}approve`;

const SPECS = new Map(CATALOG.map((t) => [t.name, t]));

export type TurnMcpDeps = HandoffMcpDeps & { approvalTimeoutMs: number; uiTimeoutMs: number };

const decision = (value: { behavior: "allow"; updatedInput: unknown } | { behavior: "deny"; message: string }) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

/**
 * The MCP server one assistant turn talks to: the catalog's data tools, answering as the assistant,
 * with untrusted results wrapped as data, its UI tools and the turn's page tools, which the panel runs in
 * the page, and `approve`, which puts every state-changing call to the person on an approval card and waits.
 */
export function createTurnMcpServer(turn: LiveTurn, deps: TurnMcpDeps): McpServer {
  const server = new McpServer({ name: "handoff", version: "1.0.0" });
  // In a chat on a project, a tool that needs a project uses the chat's when the call leaves it out.
  registerDataTools(server, { ...deps, actor: "assistant" }, { wrapUntrusted: true, project: turn.project });
  // UI tools run in the person's browser: the call goes to the panel, and the page's answer comes back.
  // So do the tools of the page the person asked on, the ones it bound when the turn started.
  for (const spec of [...CATALOG.filter((t) => t.kind === "ui"), ...pageSpecsOf(turn.page)]) {
    const { description, inputSchema } = forChatProject(spec, turn.project);
    server.registerTool(spec.name, { title: spec.title, description, inputSchema, annotations: annotationsOf(spec) }, async (given) => {
      const args = withChatProject(spec, given, turn.project);
      // Only the server knows a project's plan mode, so it refuses the other mode's Plan view here.
      const refusal = await planViewRefusal(deps.db, spec.name, args);
      if (refusal) return { content: [{ type: "text" as const, text: refusal }], isError: true };
      const result = await turn.requestUi({ name: spec.name, args }, deps.uiTimeoutMs);
      return { content: [{ type: "text" as const, text: result.text }], ...(result.isError ? { isError: true } : {}) };
    });
  }
  // The tools approve knows: the catalog's and this turn's page tools, never another page's.
  const specs = new Map<string, ToolSpec | PageToolSpec>([...SPECS, ...pageSpecsOf(turn.page).map((s) => [s.name, s] as const)]);
  server.registerTool(
    "approve",
    {
      description: "Asks the person looking at the dashboard to approve a tool call. Claude Code calls this itself; do not call it.",
      inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() },
    },
    async ({ tool_name, input, tool_use_id }) => {
      const spec = tool_name.startsWith(TOOL_PREFIX) ? specs.get(tool_name.slice(TOOL_PREFIX.length)) : undefined;
      if (!spec) return decision({ behavior: "deny", message: `${tool_name} is not one of handoff's tools.` });
      // The card names the project the call runs in, also when the call left it to the chat's project.
      const filled = withChatProject(spec, input, turn.project);
      if (!spec.confirm) return decision({ behavior: "allow", updatedInput: filled });
      // A page tool the page would refuse gets no card: the page says why, and the reply tells the person.
      if (spec.kind === "page") {
        const check = await turn.requestUi({ name: spec.name, args: filled }, deps.uiTimeoutMs, { check: true });
        if (check.isError) return decision({ behavior: "deny", message: `The page refused this, so the person was not asked: ${check.text}` });
      }
      const parsed = spec.input.safeParse(filled);
      const summary = parsed.success ? spec.summarize(parsed.data) : spec.title;
      const answer = await turn.requestApproval({ toolUseId: tool_use_id, name: spec.name, title: spec.title, summary, args: filled }, deps.approvalTimeoutMs);
      return answer.approved
        ? decision({ behavior: "allow", updatedInput: filled })
        : decision({ behavior: "deny", message: `The person did not approve this${answer.note ? `: ${answer.note}` : "."} Do not try it again in this turn.` });
    },
  );
  return server;
}

const text = (status: number, message: string) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * Serves MCP to the Claude Code process of one running assistant turn. It needs that turn's token,
 * which stops working when the turn ends, and refuses requests from a browser.
 */
export async function handleTurnMcpRequest(request: Request, deps: TurnMcpDeps): Promise<Response> {
  if (request.headers.get("origin")) return text(403, "The assistant's tools are not for browsers.");
  const turn = turnByToken(request.headers.get("authorization"));
  if (!turn) return text(401, "The turn token is missing, wrong or expired.");
  if (request.method !== "POST") {
    return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { status: 405, headers: { allow: "POST" } });
  }
  const server = createTurnMcpServer(turn, deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  // The SDK's transport declares optional members without `| undefined`, which exactOptionalPropertyTypes rejects.
  await server.connect(transport as never);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
