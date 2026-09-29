#!/usr/bin/env node
// Fake `claude` binary for tests. Replays a scripted stream-json scenario.
// FAKE_CLAUDE_SCENARIO: path to JSON { lines, lineDelayMs, stderrLines, exitCode, edits, gitCommit, hangAfterLine, ignoreSigint, chunkSplit }
// FAKE_CLAUDE_RECORD: path; one JSON line { argv, cwd, stdin, env } is appended per invocation.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const scenario = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_SCENARIO, "utf8"));
const argv = process.argv.slice(2);
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
