import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";
import { assistantConfig } from "@/server/assistant/env";
import { handleTurnMcpRequest } from "@/server/assistant/turn-mcp";

export const dynamic = "force-dynamic";

/** handoff's tools for the Claude Code process of a running assistant turn, which holds the turn's token. */
async function handle(request: Request) {
  return handleTurnMcpRequest(request, { db: getDb(), github: getGitHub(), baseUrl: new URL(request.url).origin, approvalTimeoutMs: assistantConfig().approvalTimeoutMs });
}

export { handle as GET, handle as POST, handle as DELETE };
