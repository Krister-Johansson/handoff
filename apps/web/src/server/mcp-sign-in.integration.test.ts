import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { upsertMcpServer } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { McpOAuthStore, mcpSignInStatus } from "@handoff/engine/mcp-oauth";
import { startOAuthMcpServer, type OAuthMcpServer } from "@handoff/engine/testing/oauth-server";
import { completeSignIn, startSignIn } from "./mcp-sign-in";

const db = createTestDb();
const ORIGIN = "http://localhost:3000";
let server: OAuthMcpServer;
let store: McpOAuthStore;

beforeEach(async () => {
  await truncateAll(db);
  server = await startOAuthMcpServer();
  store = new McpOAuthStore(mkdtempSync(join(tmpdir(), "handoff-oauth-")));
});
afterEach(() => server.close());
afterAll(() => db.$client.end());

/** The authorization server approves at once; returns the callback URL it sends the browser to. */
async function approve(url: string) {
  return new URL((await fetch(url, { redirect: "manual" })).headers.get("location") ?? "");
}

test("signing in to a saved OAuth server sends the browser to its authorization server and back to the server's page", async () => {
  await upsertMcpServer(db, { name: "docs", transport: "http", url: server.url, auth: "oauth" });
  const started = await startSignIn(db, store, "docs", ORIGIN);
  if (!("redirect" in started)) throw new Error(started.error);
  const callback = await approve(started.redirect);
  expect(`${callback.origin}${callback.pathname}`).toBe(`${ORIGIN}/api/mcp-oauth/callback`);

  expect(await completeSignIn(db, store, callback.searchParams)).toEqual({ redirect: "/library/mcp/docs?signed_in=1" });
  expect(mcpSignInStatus(store, "docs", server.url)).toMatchObject({ connected: true });
});

test("only a saved http server set to OAuth sign-in can sign in", async () => {
  await upsertMcpServer(db, { name: "plain", transport: "http", url: server.url });
  expect(await startSignIn(db, store, "plain", ORIGIN)).toEqual({ error: expect.stringMatching(/OAuth/) });
  expect(await startSignIn(db, store, "ghost", ORIGIN)).toEqual({ error: expect.stringMatching(/ghost/) });
});

test("a denied sign-in returns to the server's page with the reason", async () => {
  await upsertMcpServer(db, { name: "docs", transport: "http", url: server.url, auth: "oauth" });
  const started = await startSignIn(db, store, "docs", ORIGIN);
  if (!("redirect" in started)) throw new Error(started.error);
  const state = new URL(started.redirect).searchParams.get("state") ?? "";
  const result = await completeSignIn(db, store, new URLSearchParams({ state, error: "access_denied", error_description: "The user said no" }));
  expect(result).toEqual({ redirect: `/library/mcp/docs?oauth_error=${encodeURIComponent("The user said no")}` });
  expect(await completeSignIn(db, store, new URLSearchParams({ state: "forged", code: "x" }))).toEqual({ error: expect.stringMatching(/unknown or has expired/) });
});
