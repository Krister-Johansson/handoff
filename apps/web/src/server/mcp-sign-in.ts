import { getLibraryByNames, type Db } from "@handoff/db";
import { abandonMcpSignIn, beginMcpSignIn, finishMcpSignIn, type McpOAuthStore } from "@handoff/engine/mcp-oauth";

export const CALLBACK_PATH = "/api/mcp-oauth/callback";

const serverPage = (name: string) => `/library/mcp/${encodeURIComponent(name)}`;

/**
 * Starts an OAuth sign-in for a saved MCP server. Returns where to send the browser: the
 * authorization server, or straight back to the server's page when a refresh was enough.
 */
export async function startSignIn(db: Db, store: McpOAuthStore, name: string, origin: string): Promise<{ redirect: string } | { error: string }> {
  const [server] = (await getLibraryByNames(db, { skills: [], mcp: [name], agents: [] })).mcp;
  if (!server) return { error: `There is no MCP server named ${name}.` };
  if (server.transport !== "http" || server.auth !== "oauth" || !server.url) return { error: "Only an http server set to OAuth sign-in can sign in. Save it with that setting first." };
  try {
    const begun = await beginMcpSignIn(store, { name, serverUrl: server.url, redirectUrl: `${origin}${CALLBACK_PATH}` });
    return { redirect: "authorizationUrl" in begun ? begun.authorizationUrl : `${serverPage(name)}?signed_in=1` };
  } catch (error) {
    return { error: `Could not start the sign-in: ${(error as Error).message}` };
  }
}

/** Handles the authorization server's redirect back to the dashboard. */
export async function completeSignIn(store: McpOAuthStore, params: URLSearchParams): Promise<{ redirect: string } | { error: string }> {
  const state = params.get("state") ?? "";
  const denied = params.get("error");
  if (denied) {
    const name = abandonMcpSignIn(store, state);
    const reason = params.get("error_description") || denied;
    return name ? { redirect: `${serverPage(name)}?oauth_error=${encodeURIComponent(reason)}` } : { error: reason };
  }
  try {
    const { name } = await finishMcpSignIn(store, { state, code: params.get("code") ?? "" });
    return { redirect: `${serverPage(name)}?signed_in=1` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
