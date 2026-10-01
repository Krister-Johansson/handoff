import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const server = fileURLToPath(new URL("./permission-server.mjs", import.meta.url));
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function connect(dir: string, timeoutMs = 10_000) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, dir, String(timeoutMs)] }));
  clients.push(client);
  return client;
}

const requests = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".request.json"));
const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0]!.text) as Record<string, unknown>;

test("a permission request is written for handoff, and the answer it writes back is what Claude Code gets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "permissions-"));
  const client = await connect(dir);
  expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["approve"]);
  const input = { command: "git -C /w log --oneline -8", description: "Show history" };
  const pending = client.callTool({ name: "approve", arguments: { tool_name: "Bash", input, tool_use_id: "toolu_1" } });
  await expect.poll(() => requests(dir).length).toBe(1);
  const file = requests(dir)[0]!;
  expect(JSON.parse(readFileSync(join(dir, file), "utf8"))).toMatchObject({ toolName: "Bash", input, toolUseId: "toolu_1" });
  writeFileSync(join(dir, file.replace(".request.json", ".response.json")), JSON.stringify({ behavior: "allow" }));
  expect(text(await pending)).toEqual({ behavior: "allow", updatedInput: input });
});

test("a denial carries the person's message, and no answer in time is a denial", async () => {
  const dir = mkdtempSync(join(tmpdir(), "permissions-"));
  const client = await connect(dir, 300);
  const denied = client.callTool({ name: "approve", arguments: { tool_name: "Bash", input: { command: "rm -rf /" } } });
  await expect.poll(() => requests(dir).length).toBe(1);
  // The server timed out before anyone answered.
  expect(text(await denied)).toEqual({ behavior: "deny", message: expect.stringMatching(/No one approved/) });

  const dir2 = mkdtempSync(join(tmpdir(), "permissions-"));
  const client2 = await connect(dir2);
  const answered = client2.callTool({ name: "approve", arguments: { tool_name: "Bash", input: { command: "curl x" } } });
  await expect.poll(() => requests(dir2).length).toBe(1);
  const file = requests(dir2)[0]!;
  writeFileSync(join(dir2, file.replace(".request.json", ".response.json")), JSON.stringify({ behavior: "deny", message: "Use the API client instead." }));
  expect(text(await answered)).toEqual({ behavior: "deny", message: "Use the API client instead." });
  expect(existsSync(join(dir2, file))).toBe(true);
});
