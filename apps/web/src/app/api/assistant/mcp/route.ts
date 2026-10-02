import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import { assistantConfig } from "@/server/assistant/env";
import { handleTurnMcpRequest } from "@/server/assistant/turn-mcp";

export const dynamic = "force-dynamic";

/** handoff's tools for the Claude Code process of a running assistant turn, which holds the turn's token. */
async function handle(request: Request) {
  const { approvalTimeoutMs, uiTimeoutMs } = assistantConfig();
  return handleTurnMcpRequest(request, { db: getDb(), github: getGitHub(), projects: getProjects(), baseUrl: new URL(request.url).origin, approvalTimeoutMs, uiTimeoutMs });
}

export { handle as GET, handle as POST, handle as DELETE };
