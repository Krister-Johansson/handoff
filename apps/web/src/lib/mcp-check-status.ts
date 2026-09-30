import type { McpCheck } from "@handoff/engine/mcp-check";

/** How each MCP server check status is labelled, and the status tone it is shown in. */
export const CHECK_STATUS: Record<McpCheck["status"], { label: string; tone: string }> = {
  ok: { label: "Connected", tone: "succeeded" },
  needs_auth: { label: "Needs authentication", tone: "waiting" },
  missing_secrets: { label: "Missing secrets", tone: "waiting" },
  failed: { label: "Failed", tone: "failed" },
};
