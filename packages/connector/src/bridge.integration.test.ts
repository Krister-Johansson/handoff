import { readFileSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { createBridge, type Bridge } from "./bridge.ts";

type Item = { id: string; kind: string; title: string; body: string; url: string };
let items: Item[] = [];
/** Tools the stand-in gains while a session runs, as the dashboard does when it ships new tools. */
let added: string[] = [];
/** The stand-in answers 503 while down, as a dashboard that is restarting does. */
let down = false;
let http: HttpServer;
let url = "";
let bridge: Bridge | undefined;
/** The stand-in's slow tool, as a large schedule is: it answers once released. */
let slowStarted = false;
let slowDone: Promise<void>;
let releaseSlow: () => void = () => {};
const RUN_CARD = "ui://handoff/run-card.html";
const RUN_CARD_CONTENTS = [{ uri: RUN_CARD, mimeType: "text/html;profile=mcp-app", text: "<!doctype html><p>run</p>", _meta: { ui: { csp: { connectDomains: [] }, prefersBorder: false } } }];

/** A stand-in for the dashboard's /api/mcp: bearer token "tok", an echo tool, a slow tool, list_attention, and get_run with its run card. */
beforeEach(async () => {
  items = [];
  added = [];
  down = false;
  slowStarted = false;
  slowDone = new Promise((resolve) => (releaseSlow = resolve));
  http = createServer(async (req, res) => {
    if (down) return void res.writeHead(503).end("Restarting.");
    if (req.headers.authorization !== "Bearer tok") return void res.writeHead(401).end("The token is missing or wrong.");
    const server = new McpServer({ name: "handoff", version: "1.0.0" });
    server.registerTool("echo", { inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: "text", text: `echo ${text}` }] }));
    server.registerTool("list_attention", {}, async () => ({ content: [{ type: "text", text: JSON.stringify(items) }] }));
    server.registerTool("list_projects", {}, async () => ({ content: [{ type: "text", text: JSON.stringify([{ name: "sandbox", id: "p1", repo: "octo/sample" }]) }] }));
    server.registerTool("get_project", { description: "A project.", inputSchema: { project: z.string().describe("Project name or id") } }, async ({ project }) => ({
      content: [{ type: "text", text: JSON.stringify({ name: project }) }],
    }));
    // get_run links to its view as the dashboard's does: a ui:// resource of MCP Apps.
    server.registerTool("get_run", { inputSchema: { run_id: z.string() }, _meta: { ui: { resourceUri: RUN_CARD } } }, async ({ run_id }) => ({
      content: [{ type: "text", text: JSON.stringify({ id: run_id }) }],
    }));
    server.registerResource("Run card", RUN_CARD, { mimeType: "text/html;profile=mcp-app" }, async () => ({ contents: RUN_CARD_CONTENTS }));
    server.registerTool("add_project", { inputSchema: { repo: z.string() } }, async ({ repo }) => ({ content: [{ type: "text", text: JSON.stringify({ repo }) }] }));
    server.registerTool("list_runs", { inputSchema: { project: z.string().optional() } }, async ({ project }) => ({ content: [{ type: "text", text: JSON.stringify({ project: project ?? "all" }) }] }));
    server.registerTool("slow", {}, async () => {
      slowStarted = true;
      await slowDone;
      return { content: [{ type: "text", text: "done" }] };
    });
    for (const name of added) server.registerTool(name, {}, async () => ({ content: [{ type: "text", text: name }] }));
    // Stateless mode; the casts only bridge the SDK's optional-property types and exactOptionalPropertyTypes.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true } as never);
    res.on("close", () => void transport.close());
    await server.connect(transport as never);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterEach(async () => {
  vi.useRealTimers();
  releaseSlow();
  await bridge?.stop();
  bridge = undefined;
  // A keep-alive socket whose idle timer was faked never times out, so close it.
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

const ChannelSchema = z.object({ method: z.literal("notifications/claude/channel"), params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }) });

async function connect(token: string, session: { folder?: string; repo?: string } = {}) {
  bridge = createBridge({ url, token, pollMs: 25, version: "9.9.9", ...session });
  const client = new Client({ name: "claude-code", version: "test" });
  const pushed: z.infer<typeof ChannelSchema>["params"][] = [];
  const toolsChanged: number[] = [];
  client.setNotificationHandler(ChannelSchema, ({ params }) => void pushed.push(params));
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => void toolsChanged.push(Date.now()));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([bridge.start(serverSide), client.connect(clientSide)]);
  return { client, pushed, toolsChanged };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the dashboard's tools are passed through, and the bridge declares itself a channel", async () => {
  const { client } = await connect("tok");
  expect(client.getServerCapabilities()?.experimental).toEqual({ "claude/channel": {} });
  expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["add_project", "current_project", "echo", "get_project", "get_run", "list_attention", "list_projects", "list_runs", "slow"]);
  expect(await client.callTool({ name: "echo", arguments: { text: "hi" } })).toMatchObject({ content: [{ type: "text", text: "echo hi" }] });
});

test("the dashboard's MCP Apps views pass through: the resources capability, the ui:// resource and the tool's _meta", async () => {
  const { client } = await connect("tok");
  expect(client.getServerCapabilities()?.resources).toEqual({});
  const getRun = (await client.listTools()).tools.find((t) => t.name === "get_run");
  expect(getRun?._meta).toEqual({ ui: { resourceUri: RUN_CARD } });
  expect((await client.listResources()).resources).toEqual([{ uri: RUN_CARD, name: "Run card", mimeType: "text/html;profile=mcp-app" }]);
  expect(await client.readResource({ uri: RUN_CARD })).toEqual({ contents: RUN_CARD_CONTENTS });
  // The result is the dashboard's own, its text unchanged.
  expect(await client.callTool({ name: "get_run", arguments: { run_id: "r1" } })).toEqual({ content: [{ type: "text", text: JSON.stringify({ id: "r1" }) }] });
});

test("while the dashboard is down, the resource list is empty and a read says what to fix", async () => {
  down = true;
  const { client } = await connect("tok");
  expect((await client.listResources()).resources).toEqual([]);
  await expect(client.readResource({ uri: RUN_CARD })).rejects.toThrow(/handoff is not reachable/);
});

test("each new item that needs attention is pushed once; what was there at the start is not", async () => {
  items = [{ id: "failed:1", kind: "failed", title: "sandbox: run failed at coder", body: "Add a CHANGELOG.md", url: "http://localhost:3000/runs/r1" }];
  const { pushed } = await connect("tok");
  await wait(100);
  expect(pushed).toEqual([]);
  items = [...items, { id: "question:2", kind: "question", title: "sandbox: gate asks a question", body: "Which license?", url: "http://localhost:3000/runs/r2" }];
  await wait(150);
  expect(pushed).toEqual([
    { content: "sandbox: gate asks a question\nWhich license?\nhttp://localhost:3000/runs/r2", meta: { kind: "question", run_id: "r2", item_id: "question:2" } },
  ]);
});

test("when the dashboard gains a tool, the bridge tells Claude Code its tool list changed, once, and the next list has it", async () => {
  const { client, toolsChanged } = await connect("tok");
  expect((await client.listTools()).tools.map((t) => t.name)).not.toContain("schedule");
  await wait(150);
  expect(toolsChanged).toEqual([]);
  added = ["schedule"];
  await wait(150);
  expect(toolsChanged).toHaveLength(1);
  expect((await client.listTools()).tools.map((t) => t.name)).toContain("schedule");
  expect(await client.callTool({ name: "schedule", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "schedule" }] });
  await wait(150);
  expect(toolsChanged).toHaveLength(1);
});

test("a tool list that came back empty while the dashboard was down is announced as changed once the dashboard answers", async () => {
  down = true;
  const { client, toolsChanged } = await connect("tok");
  expect((await client.listTools()).tools).toEqual([]);
  await wait(100);
  expect(toolsChanged).toEqual([]);
  down = false;
  await wait(150);
  expect(toolsChanged).toHaveLength(1);
  expect((await client.listTools()).tools.map((t) => t.name)).toContain("echo");
});

test("get_project and current_project say which bridge version this session runs", async () => {
  const { client } = await connect("tok", { folder: "/work/sample", repo: "octo/sample" });
  expect(text(await client.callTool({ name: "get_project", arguments: {} }))).toMatchObject({ name: "sandbox", bridge: { version: "9.9.9" } });
  expect(text(await client.callTool({ name: "current_project", arguments: {} }))).toMatchObject({ bridge: { version: "9.9.9" } });
});

test("a wrong token comes back as a tool error that says what to fix", async () => {
  const { client } = await connect("wrong");
  const result = (await client.callTool({ name: "list_attention", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toMatch(/token/i);
});

test("the bridge runs over stdio from the environment Claude Code gives it", async () => {
  const main = fileURLToPath(new URL("./main.ts", import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", main], env: { ...(process.env as Record<string, string>), HANDOFF_URL: url, HANDOFF_TOKEN: "tok" } });
  const client = new Client({ name: "claude-code", version: "test" });
  await client.connect(transport);
  try {
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("echo");
  } finally {
    await client.close();
  }
});

test("the bundled plugin server runs on its own, the way the installed plugin starts it", async () => {
  const bundle = fileURLToPath(new URL("../../../plugins/handoff/server/handoff-mcp.mjs", import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: [bundle], env: { PATH: process.env.PATH ?? "", HANDOFF_URL: url, HANDOFF_TOKEN: "tok" } });
  const client = new Client({ name: "claude-code", version: "test" });
  await client.connect(transport);
  try {
    expect((await client.callTool({ name: "echo", arguments: { text: "bundled" } })) as object).toMatchObject({ content: [{ text: "echo bundled" }] });
    expect((await client.readResource({ uri: RUN_CARD })).contents).toEqual(RUN_CARD_CONTENTS);
    const { version } = JSON.parse(readFileSync(fileURLToPath(new URL("../../../plugins/handoff/.claude-plugin/plugin.json", import.meta.url)), "utf8"));
    expect(text(await client.callTool({ name: "current_project", arguments: {} }))).toMatchObject({ bridge: { version } });
  } finally {
    await client.close();
  }
});

const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0]!.text);

test("in a folder of a known repository, tools default to its project and current_project names it", async () => {
  const { client } = await connect("tok", { folder: "/work/sample", repo: "octo/sample" });
  const getProject = (await client.listTools()).tools.find((t) => t.name === "get_project");
  expect(getProject?.inputSchema.required ?? []).not.toContain("project");
  expect(getProject?.description).toMatch(/this session's project/);
  expect(text(await client.callTool({ name: "get_project", arguments: {} }))).toMatchObject({ name: "sandbox" });
  expect(text(await client.callTool({ name: "get_project", arguments: { project: "other" } }))).toMatchObject({ name: "other" });
  // An optional project is a filter: leaving it out still means every project.
  expect(text(await client.callTool({ name: "list_runs", arguments: {} }))).toEqual({ project: "all" });
  expect(text(await client.callTool({ name: "current_project", arguments: {} }))).toMatchObject({ folder: "/work/sample", repo: "octo/sample", project: { name: "sandbox", id: "p1" } });
});

test("in a folder of a repository handoff does not know, add_project adds that repository", async () => {
  const { client } = await connect("tok", { folder: "/work/widgets", repo: "octo/widgets" });
  expect(text(await client.callTool({ name: "current_project", arguments: {} }))).toMatchObject({ repo: "octo/widgets", project: null, next: expect.stringMatching(/add_project/) });
  const missing = (await client.callTool({ name: "get_project", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
  expect(missing.isError).toBe(true);
  expect(missing.content[0]?.text).toMatch(/octo\/widgets is not a handoff project yet/);
  expect(text(await client.callTool({ name: "add_project", arguments: {} }))).toEqual({ repo: "octo/widgets" });
});

test("outside a GitHub repository the project has to be named", async () => {
  const { client } = await connect("tok", { folder: "/tmp/scratch" });
  const result = (await client.callTool({ name: "get_project", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toMatch(/name the project/i);
});

/** Turns the event loop until the stand-in's slow tool runs, without timers, which a test may fake. */
async function untilSlowStarted() {
  while (!slowStarted) await new Promise((resolve) => setImmediate(resolve));
}

/** Claude Code's own wait for a stdio server is far longer; this is the outer client's. */
const LONG = { timeout: 60 * 60_000 };

test("a tool call that takes minutes, as a large schedule can, answers instead of failing at the MCP SDK's one-minute default", async () => {
  const { client } = await connect("tok");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const call = client.callTool({ name: "slow", arguments: {} }, undefined, LONG);
  await untilSlowStarted();
  vi.advanceTimersByTime(3 * 60_000);
  releaseSlow();
  expect(await call).toMatchObject({ content: [{ type: "text", text: "done" }] });
});

test("a tool call past the bridge's four minutes says handoff may still be working, not that it is unreachable, and the next call works", async () => {
  const { client } = await connect("tok");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const call = client.callTool({ name: "slow", arguments: {} }, undefined, LONG);
  await untilSlowStarted();
  vi.advanceTimersByTime(4 * 60_000 + 1);
  const result = (await call) as { isError?: boolean; content: { text: string }[] };
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toMatch(/handoff did not answer slow within 4 minutes/);
  expect(result.content[0]?.text).not.toMatch(/not reachable/);
  releaseSlow();
  vi.useRealTimers();
  expect(await client.callTool({ name: "echo", arguments: { text: "after" } })).toMatchObject({ content: [{ type: "text", text: "echo after" }] });
});
