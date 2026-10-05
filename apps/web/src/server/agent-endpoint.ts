import { WebStandardStreamableHTTPServerTransport, type McpServer } from "@modelcontextprotocol/server";
import type { AgentTokenStore } from "./agent-token";
import { isSameLocalOrigin } from "./local-request";

export type AgentConnection = { client: string; at: Date };

const memory = globalThis as unknown as { handoffAgentConnection?: AgentConnection };

/** The agent that used /api/mcp last, for the settings page. Kept in memory: a restart forgets it. */
export const lastAgentConnection = () => memory.handoffAgentConnection;

const text = (status: number, message: string) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** The client's name and version from an initialize request, when this is one. */
async function clientOf(request: Request): Promise<string | undefined> {
  if (request.method !== "POST") return undefined;
  try {
    const body = (await request.clone().json()) as { method?: string; params?: { clientInfo?: { name?: string; version?: string } } };
    const info = body.method === "initialize" ? body.params?.clientInfo : undefined;
    return info?.name ? [info.name, info.version].filter(Boolean).join(" ") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serves MCP to agents such as Claude Code. Each request gets its own server and stateless transport.
 * Agents need the connection token; browsers on other sites are refused even with it.
 */
export async function handleMcpRequest(request: Request, deps: { tokens: AgentTokenStore; makeServer: () => McpServer }): Promise<Response> {
  if (!deps.tokens.read()) return text(403, "Agent connections are off. Turn them on in handoff's Settings.");
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return text(403, "Only agents on this machine can connect.");
  if (!deps.tokens.verify(request.headers.get("authorization"))) return text(401, "The token is missing or wrong. Copy it from handoff's Settings.");

  // Stateless: there is no session to stream to or end, so only POST is served.
  if (request.method !== "POST") {
    return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { status: 405, headers: { allow: "POST" } });
  }

  const client = await clientOf(request);
  memory.handoffAgentConnection = { client: client ?? memory.handoffAgentConnection?.client ?? "An agent", at: new Date() };

  const server = deps.makeServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
