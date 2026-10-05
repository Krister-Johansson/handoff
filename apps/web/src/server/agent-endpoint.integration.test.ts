import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { beforeEach, expect, test } from "vitest";
import { lastAgentConnection, handleMcpRequest } from "./agent-endpoint";
import { AgentTokenStore } from "./agent-token";

let tokens: AgentTokenStore;
const makeServer = () => new McpServer({ name: "handoff", version: "1.0.0" });
beforeEach(() => {
  tokens = new AgentTokenStore(join(mkdtempSync(join(tmpdir(), "handoff-agent-")), "agent-token"));
});

const initialize = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.285" } } }),
  });

test("with agent connections off every request is refused", async () => {
  const res = await handleMcpRequest(initialize({ authorization: "Bearer x" }), { tokens, makeServer });
  expect(res.status).toBe(403);
  expect(await res.text()).toMatch(/Settings/);
});

test("a wrong token is refused, and so is a web page from another site", async () => {
  const token = tokens.create();
  expect((await handleMcpRequest(initialize({ authorization: "Bearer wrong" }), { tokens, makeServer })).status).toBe(401);
  expect((await handleMcpRequest(initialize({ authorization: `Bearer ${token}`, origin: "https://evil.example.com" }), { tokens, makeServer })).status).toBe(403);
});

test("an agent with the token is served, and its connection is remembered for the settings page", async () => {
  const token = tokens.create();
  const res = await handleMcpRequest(initialize({ authorization: `Bearer ${token}` }), { tokens, makeServer });
  expect(res.status).toBe(200);
  expect(JSON.stringify(await res.json())).toContain('"name":"handoff"');
  expect(lastAgentConnection()).toMatchObject({ client: "claude-code 2.1.285", at: expect.any(Date) });
});

test("only POST is served, since there are no sessions", async () => {
  const token = tokens.create();
  const res = await handleMcpRequest(new Request("http://localhost:3000/api/mcp", { method: "GET", headers: { host: "localhost:3000", authorization: `Bearer ${token}` } }), { tokens, makeServer });
  expect(res.status).toBe(405);
});
