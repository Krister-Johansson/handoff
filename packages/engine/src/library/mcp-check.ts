import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { resolveSecrets } from "./materialize.ts";

export type McpServerConfig = {
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string>;
  headers: Record<string, string>;
};

export type McpTool = { name: string; description?: string; inputSchema?: unknown };

export type McpCheck = {
  status: "ok" | "needs_auth" | "missing_secrets" | "failed";
  checkedAt: string;
  durationMs: number;
  server?: { name: string; version: string };
  tools: McpTool[];
  resources: number;
  prompts: number;
  message?: string;
  missingSecrets?: string[];
};

const STDERR_TAIL = 2000;

class Timeout extends Error {}

// The SDK's transport classes declare optional members without `| undefined`, which this repo's
// exactOptionalPropertyTypes rejects when passing them as Transport; they are Transports.
const asTransport = (transport: unknown) => transport as Transport;

const needsAuth = (error: unknown) => {
  const e = error as { code?: unknown; message?: string; name?: string };
  return e?.name === "UnauthorizedError" || e?.code === 401 || /\b401\b|unauthori[sz]ed/i.test(e?.message ?? "");
};

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Timeout(`did not answer within ${Math.round(ms / 1000)}s`)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** Lists every page of a list endpoint. */
async function all<T>(list: (cursor?: string) => Promise<{ nextCursor?: string | undefined }>, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await list(cursor);
    out.push(...(((result as Record<string, unknown>)[key] as T[] | undefined) ?? []));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return out;
}

/**
 * Connects to an MCP server the way a node run would (secrets resolved from `secrets`), and reports
 * whether it answers, needs authentication or lacks secrets, with its tools, resources and prompts.
 */
export async function checkMcpServer(server: McpServerConfig, opts: { secrets: Record<string, string | undefined>; timeoutMs?: number }): Promise<McpCheck> {
  const started = Date.now();
  const done = (result: Omit<McpCheck, "checkedAt" | "durationMs" | "tools" | "resources" | "prompts"> & Partial<McpCheck>): McpCheck => ({
    tools: [],
    resources: 0,
    prompts: 0,
    ...result,
    checkedAt: new Date().toISOString(),
    durationMs: Math.max(1, Date.now() - started),
  });

  const missing = new Set<string>();
  const env = resolveSecrets(server.env, opts.secrets, missing);
  const headers = resolveSecrets(server.headers, opts.secrets, missing);
  if (missing.size) {
    const names = [...missing].sort();
    return done({ status: "missing_secrets", missingSecrets: names, message: `Not set in this environment: ${names.join(", ")}` });
  }

  let stderr = "";
  const transports: { close(): Promise<void> }[] = [];
  const client = new Client({ name: "handoff-check", version: "1.0.0" });
  const connect = async () => {
    if (server.transport === "stdio") {
      if (!server.command) throw new Error("A stdio server needs a command.");
      const transport = new StdioClientTransport({ command: server.command, args: server.args, env: { ...getDefaultEnvironment(), ...env }, stderr: "pipe" });
      transport.stderr?.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL)));
      transports.push(transport);
      await client.connect(asTransport(transport));
      return;
    }
    if (!server.url) throw new Error("An http server needs a URL.");
    const url = new URL(server.url);
    const streamable = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    transports.push(streamable);
    try {
      await client.connect(asTransport(streamable));
    } catch (error) {
      if (needsAuth(error)) throw error;
      // Older servers speak SSE instead of streamable HTTP.
      const sse = new SSEClientTransport(url, { requestInit: { headers }, eventSourceInit: { fetch: (input, init) => fetch(input, { ...init, headers: { ...init?.headers, ...headers } }) } });
      transports.push(sse);
      await client.connect(asTransport(sse));
    }
  };

  try {
    return await withTimeout(
      (async () => {
        await connect();
        const info = client.getServerVersion();
        const capabilities = client.getServerCapabilities() ?? {};
        const tools = capabilities.tools ? await all<McpTool>((cursor) => client.listTools(cursor ? { cursor } : {}), "tools") : [];
        const resources = capabilities.resources ? (await all((cursor) => client.listResources(cursor ? { cursor } : {}), "resources")).length : 0;
        const prompts = capabilities.prompts ? (await all((cursor) => client.listPrompts(cursor ? { cursor } : {}), "prompts")).length : 0;
        return done({
          status: "ok",
          ...(info ? { server: { name: info.name, version: info.version } } : {}),
          tools: tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}), ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}) })),
          resources,
          prompts,
        });
      })(),
      opts.timeoutMs ?? 20_000,
    );
  } catch (error) {
    if (needsAuth(error)) {
      return done({ status: "needs_auth", message: `The server answered 401: it needs credentials, for example an Authorization header with \${secret:NAME}.` });
    }
    const reason = (error as Error).message.split("\n")[0] ?? String(error);
    return done({ status: "failed", message: stderr.trim() ? `${reason}\n${stderr.trim()}` : reason });
  } finally {
    await client.close().catch(() => {});
    await Promise.all(transports.map((t) => t.close().catch(() => {})));
  }
}
