import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { CATALOG } from "../../lib/assistant/catalog";
import { registerDataTools, type HandoffMcpDeps } from "../agent-mcp";
import { turnByToken, type LiveTurn } from "./relay";

/** The prefix Claude Code gives the tools of the "handoff" MCP server. */
export const TOOL_PREFIX = "mcp__handoff__";
/** The permission prompt tool the assistant's turns name: Claude Code asks it before any tool outside --allowedTools. */
export const APPROVE_TOOL = `${TOOL_PREFIX}approve`;

const SPECS = new Map(CATALOG.map((t) => [t.name, t]));

const decision = (value: { behavior: "allow"; updatedInput: unknown } | { behavior: "deny"; message: string }) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

/**
 * The MCP server one assistant turn talks to: the catalog's data tools, answering as the assistant,
 * with untrusted results wrapped as data, and `approve`, which puts every state-changing call to the
 * person on an approval card and waits.
 */
export function createTurnMcpServer(turn: LiveTurn, deps: HandoffMcpDeps & { approvalTimeoutMs: number }): McpServer {
  const server = new McpServer({ name: "handoff", version: "1.0.0" });
  registerDataTools(server, { ...deps, actor: "assistant" }, { wrapUntrusted: true });
  server.registerTool(
    "approve",
    {
      description: "Asks the person looking at the dashboard to approve a tool call. Claude Code calls this itself; do not call it.",
      inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() },
    },
    async ({ tool_name, input, tool_use_id }) => {
      const spec = tool_name.startsWith(TOOL_PREFIX) ? SPECS.get(tool_name.slice(TOOL_PREFIX.length)) : undefined;
      if (!spec || spec.kind !== "data") return decision({ behavior: "deny", message: `${tool_name} is not one of handoff's tools.` });
      if (!spec.confirm) return decision({ behavior: "allow", updatedInput: input });
      const parsed = spec.input.safeParse(input);
      const summary = parsed.success ? spec.summarize(parsed.data) : spec.title;
      const answer = await turn.requestApproval({ toolUseId: tool_use_id, name: spec.name, title: spec.title, summary, args: input }, deps.approvalTimeoutMs);
      return answer.approved
        ? decision({ behavior: "allow", updatedInput: input })
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
export async function handleTurnMcpRequest(request: Request, deps: HandoffMcpDeps & { approvalTimeoutMs: number }): Promise<Response> {
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
