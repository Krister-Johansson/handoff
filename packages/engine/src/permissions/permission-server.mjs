// handoff's permission prompt tool for Claude Code (--permission-prompt-tool mcp__handoff__approve).
// When the allow rules do not settle a tool call, Claude Code calls `approve`. The server writes the
// request to <dir>/<id>.request.json for the worker, which asks a person, and waits for
// <dir>/<id>.response.json. No answer within the timeout is a denial, so the step goes on as before.
// It talks to nothing but those files: no database or token reaches the agent's processes.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const [dir, timeoutArg] = process.argv.slice(2);
if (!dir) {
  process.stderr.write("usage: permission-server.mjs <dir> [timeoutMs]\n");
  process.exit(2);
}
// The worker passes the project's permission timeout; without one, 10 minutes, as PERMISSION_TIMEOUT_MS.
const timeoutMs = Number(timeoutArg) || 10 * 60_000;

const reply = (decision) => ({ content: [{ type: "text", text: JSON.stringify(decision) }] });

const server = new McpServer({ name: "handoff", version: "1.0.0" });
server.registerTool(
  "approve",
  {
    description: "Asks the person running handoff to approve a tool call. Claude Code calls this itself; do not call it.",
    inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() },
  },
  async ({ tool_name, input, tool_use_id }) => {
    const id = randomUUID();
    writeFileSync(join(dir, `${id}.request.json`), JSON.stringify({ id, toolName: tool_name, input, toolUseId: tool_use_id ?? null, askedAt: new Date().toISOString() }));
    const response = join(dir, `${id}.response.json`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(response)) {
        const answer = JSON.parse(readFileSync(response, "utf8"));
        return answer.behavior === "allow" ? reply({ behavior: "allow", updatedInput: input }) : reply({ behavior: "deny", message: answer.message || "The person denied this." });
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return reply({ behavior: "deny", message: "No one approved this in time. Do not retry it; find another way or finish without it." });
  },
);
await server.connect(new StdioServerTransport());
