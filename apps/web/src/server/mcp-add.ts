import { getLibraryByNames, recordMcpCheck, upsertMcpServer, type Db } from "@handoff/db";
import { checkMcpServer, type McpCheck } from "@handoff/engine/mcp-check";
import type { McpOAuthStore } from "@handoff/engine/mcp-oauth";
import { nameProblem } from "../lib/library-forms";
import { suggestMcpName } from "../lib/mcp-name";
import { startSignIn } from "./mcp-sign-in";

export type AddFromUrlResult = { redirect: string } | { manual: { name: string; url: string }; message: string } | { error: string };

/**
 * Adds an http MCP server from nothing but its URL. handoff connects to it first: a server that
 * answers is saved with its tools, one that offers OAuth is saved with OAuth sign-in and the browser
 * is sent to sign in, and one that needs a key is handed to the manual form.
 */
export async function addMcpServerFromUrl(
  db: Db,
  store: McpOAuthStore,
  input: { url: string; name?: string },
  origin: string,
  check: typeof checkMcpServer = checkMcpServer,
): Promise<AddFromUrlResult> {
  const url = input.url.trim();
  if (!/^https?:\/\/[^\s/]+/.test(url)) return { error: "Paste the server's http or https URL." };
  const name = input.name?.trim() || suggestMcpName(url);
  const problem = nameProblem(name);
  if (problem) return { error: `Name: ${problem}` };
  if ((await getLibraryByNames(db, { skills: [], mcp: [name], agents: [] })).mcp.length) {
    return { error: `There is already an MCP server named ${name}. Choose another name.` };
  }

  const result: McpCheck = await check({ name, auth: "headers", transport: "http", command: null, args: [], url, env: {}, headers: {} }, { secrets: {}, oauth: store });
  if (result.status === "ok") {
    await upsertMcpServer(db, { name, transport: "http", url });
    await recordMcpCheck(db, name, result);
    return { redirect: `/library/mcp/${name}` };
  }
  if (result.status === "needs_auth" && result.oauthAvailable) {
    await upsertMcpServer(db, { name, transport: "http", url, auth: "oauth" });
    return startSignIn(db, store, name, origin);
  }
  if (result.status === "needs_auth") {
    return { manual: { name, url }, message: "The server wants credentials and does not offer OAuth sign-in. Add its API key as a header, for example Authorization: Bearer ${secret:NAME}." };
  }
  return { error: `Could not connect: ${result.message ?? "no answer"}` };
}
