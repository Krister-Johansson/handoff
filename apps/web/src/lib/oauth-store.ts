import "server-only";
import { defaultOAuthDir, McpOAuthStore } from "@handoff/engine/mcp-oauth";

/** The OAuth store the worker reads too: HANDOFF_OAUTH_DIR, or ~/.handoff/mcp-oauth. */
export const getOAuthStore = () => new McpOAuthStore(defaultOAuthDir());
