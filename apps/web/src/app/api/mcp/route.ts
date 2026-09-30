import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";
import { handleMcpRequest } from "@/server/agent-endpoint";
import { createHandoffMcpServer } from "@/server/agent-mcp";
import { AgentTokenStore, defaultAgentTokenFile } from "@/server/agent-token";

export const dynamic = "force-dynamic";

/** handoff's tools over MCP for agents such as Claude Code; see Settings, Connect Claude Code. */
async function handle(request: Request) {
  const baseUrl = new URL(request.url).origin;
  return handleMcpRequest(request, {
    tokens: new AgentTokenStore(defaultAgentTokenFile()),
    makeServer: () => createHandoffMcpServer({ db: getDb(), github: getGitHub(), baseUrl }),
  });
}

export { handle as GET, handle as POST, handle as DELETE };
