import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { getLibraryByNames, upsertMcpServer } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { McpOAuthStore } from "@handoff/engine/mcp-oauth";
import { startOAuthMcpServer, type OAuthMcpServer } from "@handoff/engine/testing/oauth-server";
import { addMcpServerFromUrl } from "./mcp-add";
import { completeSignIn } from "./mcp-sign-in";

const db = createTestDb();
const ORIGIN = "http://localhost:3000";
let servers: OAuthMcpServer[] = [];
let store: McpOAuthStore;

beforeEach(async () => {
  await truncateAll(db);
  store = new McpOAuthStore(mkdtempSync(join(tmpdir(), "handoff-oauth-")));
});
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});
afterAll(() => db.$client.end());

const start = async (opts: { open?: boolean } = {}) => {
  const server = await startOAuthMcpServer(opts);
  servers.push(server);
  return server;
};
const saved = async (name: string) => (await getLibraryByNames(db, { skills: [], mcp: [name], agents: [] })).mcp[0];

test("a server that answers is saved with its tools and opens its page", async () => {
  const server = await start({ open: true });
  expect(await addMcpServerFromUrl(db, store, { url: server.url, name: "docs" }, ORIGIN)).toEqual({ redirect: "/library/mcp/docs" });
  const row = await saved("docs");
  expect(row).toMatchObject({ transport: "http", url: server.url, auth: "headers", lastCheck: { status: "ok", tools: [{ name: "resolve" }] } });
});

test("a server that offers OAuth is saved with OAuth sign-in and the browser goes to sign in; signing in checks it", async () => {
  const server = await start();
  const added = await addMcpServerFromUrl(db, store, { url: server.url, name: "docs" }, ORIGIN);
  if (!("redirect" in added)) throw new Error(JSON.stringify(added));
  expect((await saved("docs"))?.auth).toBe("oauth");
  const callback = new URL((await fetch(added.redirect, { redirect: "manual" })).headers.get("location") ?? "");
  expect(await completeSignIn(db, store, callback.searchParams)).toEqual({ redirect: "/library/mcp/docs?signed_in=1" });
  expect((await saved("docs"))?.lastCheck).toMatchObject({ status: "ok", tools: [{ name: "resolve" }] });
});

let keyed: Server | undefined;
afterAll(() => keyed?.close());

test("a server that wants a key without OAuth goes to the manual form with the URL filled in", async () => {
  keyed = createServer((_, res) => res.writeHead(401, { "content-type": "application/json" }).end("{}"));
  await new Promise<void>((resolve) => keyed!.listen(0, "127.0.0.1", resolve));
  const address = keyed.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/mcp`;
  expect(await addMcpServerFromUrl(db, store, { url, name: "keyed" }, ORIGIN)).toEqual({ manual: { name: "keyed", url }, message: expect.stringMatching(/header/) });
  expect(await saved("keyed")).toBeUndefined();
});

test("the name comes from the URL when none is given, and an existing name or a bad URL is refused", async () => {
  const server = await start({ open: true });
  await upsertMcpServer(db, { name: "taken", transport: "stdio", command: "npx" });
  expect(await addMcpServerFromUrl(db, store, { url: server.url, name: "taken" }, ORIGIN)).toEqual({ error: expect.stringMatching(/already/) });
  expect(await addMcpServerFromUrl(db, store, { url: "ftp://example.com" }, ORIGIN)).toEqual({ error: expect.stringMatching(/http/) });
  expect(await addMcpServerFromUrl(db, store, { url: server.url }, ORIGIN)).toEqual({ redirect: "/library/mcp/mcp-127-0-0-1" });
});
