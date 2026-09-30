#!/usr/bin/env node
// Fake `claude` binary for tests. Replays a scripted stream-json scenario.
// FAKE_CLAUDE_SCENARIO: path to JSON { lines, lineDelayMs, stderrLines, exitCode, edits, gitCommit, hangAfterLine, ignoreSigint, chunkSplit }
// FAKE_CLAUDE_RECORD: path; one JSON line { argv, cwd, stdin, env } is appended per invocation.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";

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

for (const line of scenario.stderrLines ?? []) process.stderr.write(line + "\n");

const lines = scenario.lines ?? [];
for (let i = 0; i < lines.length; i++) {
  if (scenario.hangAfterLine !== undefined && i === scenario.hangAfterLine) {
    await new Promise(() => setInterval(() => {}, 1000));
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
