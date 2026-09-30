import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { shell } from "./checks.ts";

const cwd = () => mkdtempSync(join(tmpdir(), "handoff-shell-"));
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

test("shell runs commands without the worker's secrets in their environment", async () => {
  process.env.GITHUB_TOKEN = "gho_worker_token";
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-worker";
  process.env.DATABASE_URL = "postgres://secret@localhost/db";
  const result = await shell('echo "[$GITHUB_TOKEN][$CLAUDE_CODE_OAUTH_TOKEN][$DATABASE_URL]"; command -v git >/dev/null && echo has-path', cwd(), 5_000);
  expect(result.output).toBe("[][][]\nhas-path");
});

test("shell marks the environment as CI so test runners do not wait for input", async () => {
  expect((await shell('echo "$CI"', cwd(), 5_000)).output).toBe("true");
});

test("shell redacts token-shaped strings in the output it returns", async () => {
  const token = `ghp_${"x".repeat(36)}`;
  expect((await shell(`echo "leaked ${token}"`, cwd(), 5_000)).output).toBe("leaked [redacted]");
});

test("shell keeps output lines intact across chunk boundaries", async () => {
  const result = await shell("printf 'one\\n'; sleep 0.05; printf 'tw'; sleep 0.05; printf 'o\\nthree'", cwd(), 5_000);
  expect(result.output).toBe("one\ntwo\nthree");
});

test("shell passes the variables it is told to pass from the worker environment", async () => {
  process.env.APP_TEST_DB = "postgres://localhost/app_test";
  process.env.NOT_PASSED = "hidden";
  const result = await shell('echo "[$APP_TEST_DB][$NOT_PASSED]"', cwd(), 5_000, undefined, ["APP_TEST_DB"]);
  expect(result.output).toBe("[postgres://localhost/app_test][]");
});

test("shell refuses to pass the worker's own secrets", async () => {
  await expect(shell("true", cwd(), 5_000, undefined, ["GITHUB_TOKEN"])).rejects.toThrow(/GITHUB_TOKEN/);
});
