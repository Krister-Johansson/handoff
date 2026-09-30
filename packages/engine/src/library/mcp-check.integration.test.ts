import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "vitest";
import { startOAuthMcpServer, type OAuthMcpServer } from "../testing/mcp/oauth-server.ts";
import { checkMcpServer } from "./mcp-check.ts";
import { beginMcpSignIn, finishMcpSignIn, McpOAuthStore } from "./mcp-oauth.ts";

const fixture = fileURLToPath(new URL("../testing/mcp/stdio-server.mjs", import.meta.url));
const stdio = (env: Record<string, string>) => ({ transport: "stdio" as const, command: process.execPath, args: [fixture], url: null, env, headers: {} });

test("a stdio server that starts reports its name, version, tools and resources", async () => {
  const check = await checkMcpServer(stdio({ FIXTURE_TOKEN: "${secret:DOCS_TOKEN}" }), { secrets: { DOCS_TOKEN: "s3cret" } });
  expect(check).toMatchObject({
    status: "ok",
    server: { name: "fixture-docs", version: "1.2.3" },
    tools: [
      { name: "search", description: "Search the docs" },
      { name: "fetch", description: "Fetch a page" },
    ],
    resources: 1,
    prompts: 0,
  });
  expect(check.durationMs).toBeGreaterThan(0);
});

test("a secret the environment does not have is reported without starting the server", async () => {
  expect(await checkMcpServer(stdio({ FIXTURE_TOKEN: "${secret:DOCS_TOKEN}" }), { secrets: {} })).toMatchObject({
    status: "missing_secrets",
    missingSecrets: ["DOCS_TOKEN"],
    tools: [],
  });
});

test("a stdio server that exits reports why, from its stderr", async () => {
  const check = await checkMcpServer(stdio({}), { secrets: {} });
  expect(check.status).toBe("failed");
  expect(check.message).toContain("FIXTURE_TOKEN is not set");
});

let http: Server;
let base = "";
afterAll(() => http?.close());

async function startHttp() {
  http = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer tok") {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const server = new McpServer({ name: "remote-docs", version: "0.1.0" });
    server.registerTool("lookup", { description: "Look something up" }, async () => ({ content: [{ type: "text", text: "x" }] }));
    // Stateless mode; the casts only bridge the SDK's optional-property types and exactOptionalPropertyTypes.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as never);
    res.on("close", () => void transport.close());
    await server.connect(transport as never);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/mcp`;
}

test("an http server lists its tools with the headers resolved, and says when it needs authentication", async () => {
  await startHttp();
  const server = (headers: Record<string, string>) => ({ transport: "http" as const, command: null, args: [], url: base, env: {}, headers });
  expect(await checkMcpServer(server({ Authorization: "Bearer ${secret:DOCS_TOKEN}" }), { secrets: { DOCS_TOKEN: "tok" } })).toMatchObject({
    status: "ok",
    server: { name: "remote-docs" },
    tools: [{ name: "lookup" }],
  });
  const unauthorized = await checkMcpServer(server({}), { secrets: {} });
  expect(unauthorized.status).toBe("needs_auth");
  expect(unauthorized.message).toMatch(/401/);
});

test("a server that does not answer in time is reported as failed", async () => {
  const hang = { transport: "stdio" as const, command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], url: null, env: {}, headers: {} };
  const check = await checkMcpServer(hang, { secrets: {}, timeoutMs: 800 });
  expect(check).toMatchObject({ status: "failed", message: expect.stringMatching(/did not answer within/) });
});

describe("OAuth servers", () => {
  let oauthServer: OAuthMcpServer;
  let store: McpOAuthStore;
  beforeEach(async () => {
    oauthServer = await startOAuthMcpServer();
    store = new McpOAuthStore(mkdtempSync(join(tmpdir(), "handoff-oauth-")));
  });
  afterEach(() => oauthServer.close());
  const config = (auth: "headers" | "oauth") => ({ name: "docs", auth, transport: "http" as const, command: null, args: [], url: oauthServer.url, env: {}, headers: {} });

  test("a signed-in OAuth server is checked with its access token", async () => {
    const begun = await beginMcpSignIn(store, { name: "docs", serverUrl: oauthServer.url, redirectUrl: "http://localhost:3000/cb" });
    if (!("authorizationUrl" in begun)) throw new Error("expected a redirect");
    const back = new URL((await fetch(begun.authorizationUrl, { redirect: "manual" })).headers.get("location") ?? "");
    await finishMcpSignIn(store, { code: back.searchParams.get("code") ?? "", state: back.searchParams.get("state") ?? "" });
    expect(await checkMcpServer(config("oauth"), { secrets: {}, oauth: store })).toMatchObject({ status: "ok", server: { name: "oauth-docs" }, tools: [{ name: "resolve" }] });
  });

  test("an OAuth server nobody signed in to needs sign-in", async () => {
    expect(await checkMcpServer(config("oauth"), { secrets: {}, oauth: store })).toMatchObject({ status: "needs_auth", message: expect.stringMatching(/sign in/i) });
  });

  test("a server without credentials that offers OAuth says so", async () => {
    expect(await checkMcpServer(config("headers"), { secrets: {}, oauth: store })).toMatchObject({ status: "needs_auth", oauthAvailable: true });
  });
});
