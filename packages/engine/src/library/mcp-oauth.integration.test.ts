import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { startOAuthMcpServer, type OAuthMcpServer } from "../testing/mcp/oauth-server.ts";
import { McpOAuthStore, McpSignInRequired, beginMcpSignIn, finishMcpSignIn, mcpAccessToken, mcpSignInStatus, signOutMcp } from "./mcp-oauth.ts";

const REDIRECT = "http://localhost:3000/library/mcp/oauth/callback";

let server: OAuthMcpServer;
let dir: string;
let store: McpOAuthStore;

beforeEach(async () => {
  server = await startOAuthMcpServer();
  dir = mkdtempSync(join(tmpdir(), "handoff-oauth-"));
  store = new McpOAuthStore(dir);
});
afterEach(() => server.close());

/** What the browser does: follow the authorization URL, which this server approves at once. */
async function approve(authorizationUrl: string) {
  const res = await fetch(authorizationUrl, { redirect: "manual" });
  const back = new URL(res.headers.get("location") ?? "");
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  return { code: back.searchParams.get("code") ?? "", state: back.searchParams.get("state") ?? "" };
}

async function signIn(name = "docs") {
  const begun = await beginMcpSignIn(store, { name, serverUrl: server.url, redirectUrl: REDIRECT });
  if (!("authorizationUrl" in begun)) throw new Error("expected a redirect");
  return finishMcpSignIn(store, await approve(begun.authorizationUrl));
}

test("signing in registers handoff as a client and stores the tokens in a private file, not the database", async () => {
  const begun = await beginMcpSignIn(store, { name: "docs", serverUrl: server.url, redirectUrl: REDIRECT });
  if (!("authorizationUrl" in begun)) throw new Error("expected a redirect");
  const authorize = new URL(begun.authorizationUrl);
  expect(authorize.searchParams.get("client_id")).toBe("client-1");
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("redirect_uri")).toBe(REDIRECT);
  expect(mcpSignInStatus(store, "docs", server.url)).toMatchObject({ connected: false });

  expect(await finishMcpSignIn(store, await approve(begun.authorizationUrl))).toEqual({ name: "docs" });
  expect(mcpSignInStatus(store, "docs", server.url)).toMatchObject({ connected: true, expiresAt: expect.any(String) });
  const [file] = readdirSync(dir);
  expect(statSync(join(dir, file!)).mode & 0o777).toBe(0o600);
});

test("a run gets the stored access token, and a refreshed one once it has expired", async () => {
  await signIn();
  expect(await mcpAccessToken(store, { name: "docs", serverUrl: server.url })).toBe("at-1");
  const later = Date.now() + 2 * 3600_000;
  expect(await mcpAccessToken(store, { name: "docs", serverUrl: server.url, now: later })).toBe("at-2");
  expect(await mcpAccessToken(store, { name: "docs", serverUrl: server.url, now: later })).toBe("at-2");
  expect(server.issued()).toEqual(["at-1", "at-2"]);
});

test("a server nobody signed in to, or signed in at another URL, needs sign-in", async () => {
  await expect(mcpAccessToken(store, { name: "docs", serverUrl: server.url })).rejects.toBeInstanceOf(McpSignInRequired);
  await signIn();
  await expect(mcpAccessToken(store, { name: "docs", serverUrl: `${server.url}/other` })).rejects.toBeInstanceOf(McpSignInRequired);
  expect(mcpSignInStatus(store, "docs", `${server.url}/other`)).toMatchObject({ connected: false });
});

test("a callback with an unknown or already used state is refused", async () => {
  const begun = await beginMcpSignIn(store, { name: "docs", serverUrl: server.url, redirectUrl: REDIRECT });
  if (!("authorizationUrl" in begun)) throw new Error("expected a redirect");
  const callback = await approve(begun.authorizationUrl);
  await expect(finishMcpSignIn(store, { ...callback, state: "forged" })).rejects.toThrow(/sign-in/);
  await finishMcpSignIn(store, callback);
  await expect(finishMcpSignIn(store, callback)).rejects.toThrow(/sign-in/);
});

test("signing out forgets the tokens", async () => {
  await signIn();
  signOutMcp(store, "docs");
  expect(mcpSignInStatus(store, "docs", server.url)).toMatchObject({ connected: false });
  await expect(mcpAccessToken(store, { name: "docs", serverUrl: server.url })).rejects.toBeInstanceOf(McpSignInRequired);
});

test("a server name cannot reach outside the store", () => {
  expect(() => mcpSignInStatus(store, "../escape", server.url)).toThrow(/name/);
});
