import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { createBridge, type Bridge } from "./bridge.ts";

type Item = { id: string; kind: string; title: string; body: string; url: string };
let items: Item[] = [];
let http: HttpServer;
let url = "";
let bridge: Bridge | undefined;

/** A stand-in for the dashboard's /api/mcp: bearer token "tok", an echo tool and list_attention. */
beforeEach(async () => {
  items = [];
  http = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer tok") return void res.writeHead(401).end("The token is missing or wrong.");
    const server = new McpServer({ name: "handoff", version: "1.0.0" });
    server.registerTool("echo", { inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: "text", text: `echo ${text}` }] }));
    server.registerTool("list_attention", {}, async () => ({ content: [{ type: "text", text: JSON.stringify(items) }] }));
    server.registerTool("list_projects", {}, async () => ({ content: [{ type: "text", text: JSON.stringify([{ name: "sandbox", id: "p1", repo: "octo/sample" }]) }] }));
    server.registerTool("get_project", { description: "A project.", inputSchema: { project: z.string().describe("Project name or id") } }, async ({ project }) => ({
      content: [{ type: "text", text: JSON.stringify({ name: project }) }],
    }));
    server.registerTool("add_project", { inputSchema: { repo: z.string() } }, async ({ repo }) => ({ content: [{ type: "text", text: JSON.stringify({ repo }) }] }));
    server.registerTool("list_runs", { inputSchema: { project: z.string().optional() } }, async ({ project }) => ({ content: [{ type: "text", text: JSON.stringify({ project: project ?? "all" }) }] }));
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
  await bridge?.stop();
  bridge = undefined;
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

const ChannelSchema = z.object({ method: z.literal("notifications/claude/channel"), params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }) });

async function connect(token: string, session: { folder?: string; repo?: string } = {}) {
  bridge = createBridge({ url, token, pollMs: 25, ...session });
  const client = new Client({ name: "claude-code", version: "test" });
  const pushed: z.infer<typeof ChannelSchema>["params"][] = [];
  client.setNotificationHandler(ChannelSchema, ({ params }) => void pushed.push(params));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([bridge.start(serverSide), client.connect(clientSide)]);
  return { client, pushed };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the dashboard's tools are passed through, and the bridge declares itself a channel", async () => {
  const { client } = await connect("tok");
  expect(client.getServerCapabilities()?.experimental).toEqual({ "claude/channel": {} });
  expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["add_project", "current_project", "echo", "get_project", "list_attention", "list_projects", "list_runs"]);
  expect(await client.callTool({ name: "echo", arguments: { text: "hi" } })).toMatchObject({ content: [{ type: "text", text: "echo hi" }] });
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
  expect(text(await client.callTool({ name: "get_project", arguments: {} }))).toEqual({ name: "sandbox" });
  expect(text(await client.callTool({ name: "get_project", arguments: { project: "other" } }))).toEqual({ name: "other" });
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
