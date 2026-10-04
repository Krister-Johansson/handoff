#!/usr/bin/env node
// Fake `claude` binary for tests. Replays a scripted stream-json scenario.
// FAKE_CLAUDE_SCENARIO: path to JSON { lines, lineDelayMs, stderrLines, exitCode, edits, gitCommit, hangAfterLine, ignoreSigint, chunkSplit, background, visit }
// FAKE_CLAUDE_RECORD: path; one JSON line { argv, cwd, stdin, env } is appended per invocation.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { hostname } from "node:os";

const argv = process.argv.slice(2);
if (argv[0] === "--version") {
  console.log(`${process.env.FAKE_CLAUDE_VERSION ?? "2.1.285"} (fake)`);
  process.exit(0);
}
let scenario = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_SCENARIO, "utf8"));
// byName: pick the scenario whose key appears in the --name (or --resume) value, e.g. { planner: {...}, coder: {...} }.
if (scenario.byName) {
  const flagAt = Math.max(argv.indexOf("--name"), argv.indexOf("--resume"));
  const label = flagAt >= 0 ? argv[flagAt + 1] ?? "" : "";
  const key = Object.keys(scenario.byName).find((k) => label.includes(k));
  scenario = key ? scenario.byName[key] : scenario.byName.default ?? {};
}
const sessionFromArgv = argv[argv.indexOf("--session-id") + 1];
if (sessionFromArgv && Array.isArray(scenario.lines)) {
  scenario.lines = scenario.lines.map((l) => (typeof l === "object" && l && "session_id" in l ? { ...l, session_id: sessionFromArgv } : l));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

process.on("SIGINT", () => {
  if (!scenario.ignoreSigint) process.exit(130);
});
process.on("SIGTERM", () => process.exit(143));

let stdin = "";
if (!process.stdin.isTTY) {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (stdin += c));
}

if (process.env.FAKE_CLAUDE_RECORD) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("npm_")));
  appendFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ argv, cwd: process.cwd(), env }) + "\n");
}

for (const edit of scenario.edits ?? []) {
  const path = join(process.cwd(), edit.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, edit.content);
}
if (scenario.gitCommit) {
  execFileSync("git", ["add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=fake", "-c", "user.email=fake@example.com", "commit", "-qm", scenario.gitCommit], { stdio: "ignore" });
}

// A server the agent started and left running, like `pnpm dev &`; its pid goes to a file for the test.
for (const bg of scenario.background ?? []) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "fake-dev-server"], { detached: bg.detached ?? false, stdio: "ignore" });
  child.unref();
  appendFileSync(bg.pidFile, `${child.pid}\n`);
}

// Visits the first http://localhost URL in the appended system prompt, as a demo's browser visits the app, and writes
// where it ran and what came back to the scenario's `visit` file.
if (scenario.visit) {
  const prompt = readFileSync(argv[argv.indexOf("--append-system-prompt-file") + 1], "utf8");
  const url = /http:\/\/(localhost|127\.0\.0\.1):\d+\S*?(?=[.,]?(\s|$))/.exec(prompt)?.[0];
  const seen = { url, host: hostname() };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    Object.assign(seen, { status: response.status, body: await response.text() });
  } catch (error) {
    Object.assign(seen, { error: String(error?.cause ?? error) });
  }
  writeFileSync(scenario.visit, JSON.stringify(seen));
}

for (const line of scenario.stderrLines ?? []) process.stderr.write(line + "\n");

// A {"$mcp": {tool, arguments, approve}} line plays Claude Code calling a tool of the "handoff" MCP server
// in --mcp-config over HTTP: for an approve step it first asks the --permission-prompt-tool, as Claude Code
// does for a tool outside --allowedTools, then it calls the tool and writes the tool_use and tool_result lines.
let mcpId = 0;
async function rpc(method, params) {
  const config = JSON.parse(readFileSync(argv[argv.indexOf("--mcp-config") + 1], "utf8"));
  const server = config.mcpServers.handoff;
  const response = await fetch(server.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(server.headers ?? {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++mcpId, method, params }),
  });
  const body = await response.text();
  if (!response.ok) return { error: `${response.status} ${body}` };
  const json = JSON.parse(body);
  return json.error ? { error: json.error.message } : { text: json.result.content?.[0]?.text ?? "", isError: json.result.isError === true };
}
async function mcpStep(step) {
  const name = `mcp__handoff__${step.tool}`;
  const id = `toolu_${mcpId + 1}`;
  const emit = (line) => process.stdout.write(JSON.stringify({ session_id: sessionFromArgv, parent_tool_use_id: null, ...line }) + "\n");
  emit({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input: step.arguments ?? {} }] } });
  const result = (text, isError) => emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }], is_error: isError }] } });
  if (step.approve) {
    const prompt = argv[argv.indexOf("--permission-prompt-tool") + 1].replace("mcp__handoff__", "");
    const asked = await rpc("tools/call", { name: prompt, arguments: { tool_name: name, input: step.arguments ?? {}, tool_use_id: id } });
    if (asked.error) return result(asked.error, true);
    const decision = JSON.parse(asked.text);
    if (decision.behavior !== "allow") return result(decision.message ?? "denied", true);
  }
  const called = await rpc("tools/call", { name: step.tool, arguments: step.arguments ?? {} });
  result(called.error ?? called.text, Boolean(called.error) || called.isError);
}

const lines = scenario.lines ?? [];
for (let i = 0; i < lines.length; i++) {
  if (scenario.hangAfterLine !== undefined && i === scenario.hangAfterLine) {
    await new Promise(() => setInterval(() => {}, 1000));
  }
  if (lines[i] && typeof lines[i] === "object" && "$mcp" in lines[i]) {
    await mcpStep(lines[i].$mcp);
    continue;
  }
  const raw = typeof lines[i] === "string" ? lines[i] : JSON.stringify(lines[i]);
  if (scenario.chunkSplit && raw.length > 4) {
    const mid = Math.floor(raw.length / 2);
    process.stdout.write(raw.slice(0, mid));
    await sleep(15);
    process.stdout.write(raw.slice(mid) + "\n");
  } else {
    process.stdout.write(raw + "\n");
  }
  if (scenario.lineDelayMs) await sleep(scenario.lineDelayMs);
}
if (scenario.hangAfterLine !== undefined && scenario.hangAfterLine >= lines.length) {
  await new Promise(() => setInterval(() => {}, 1000));
}
process.exitCode = scenario.exitCode ?? 0;
