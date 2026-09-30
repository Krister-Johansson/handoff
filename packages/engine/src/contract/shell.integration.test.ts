import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
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

describe("processes a command leaves behind", () => {
  const pidOf = (file: string) => Number(readFileSync(file, "utf8").trim());
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const settle = () => new Promise((r) => setTimeout(r, 300));

  test("a background process the command started is stopped when the command ends", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shell-bg-"));
    const result = await shell(`sleep 301 >/dev/null 2>&1 & echo $! > ${dir}/pid`, dir, 10_000);
    expect(result.exitCode).toBe(0);
    await settle();
    expect(alive(pidOf(join(dir, "pid")))).toBe(false);
  });

  test("a timeout stops the whole command, not only its shell", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shell-to-"));
    const result = await shell(`sleep 302 & echo $! > ${dir}/pid; wait`, dir, 300);
    expect(result.timedOut).toBe(true);
    await settle();
    expect(alive(pidOf(join(dir, "pid")))).toBe(false);
  });

  test("aborting stops a running command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shell-ab-"));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const started = Date.now();
    await shell(`sleep 303 & echo $! > ${dir}/pid; wait`, dir, 60_000, undefined, [], controller.signal);
    expect(Date.now() - started).toBeLessThan(5_000);
    await settle();
    expect(alive(pidOf(join(dir, "pid")))).toBe(false);
  });
});
