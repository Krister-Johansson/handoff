import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { fakeClaude, fakeClaudeBin, lines, SESSION_ID } from "../testing/fake-claude.ts";
import type { CliEvent, CliRunRequest } from "../types.ts";
import { ClaudeCliExecutor } from "./executor.ts";

const Contract = z.object({ status: z.enum(["done", "failed"]), summary: z.string() });

function setup(scenario: Parameters<typeof fakeClaude>[0], opts: { killGraceMs?: number } = {}) {
  const fake = fakeClaude(scenario);
  const executor = new ClaudeCliExecutor({
    command: { file: process.execPath, prefixArgs: [fakeClaudeBin] },
    oauthToken: "sk-ant-oat01-test",
    configDir: "/tmp/handoff-claude-config",
    baseEnv: { ...process.env, ANTHROPIC_API_KEY: "must-not-leak", ...fake.env },
    passthroughEnv: ["FAKE_CLAUDE_SCENARIO", "FAKE_CLAUDE_RECORD"],
    killGraceMs: opts.killGraceMs ?? 200,
  });
  const cwd = mkdtempSync(join(tmpdir(), "handoff-cwd-"));
  const stagingDir = mkdtempSync(join(tmpdir(), "handoff-stage-"));
  const request: CliRunRequest = {
    prompt: "Do the task.",
    systemPrompt: "# Task\nWrite a file.",
    cwd,
    stagingDir,
    allowedTools: ["Read", "Edit"],
    maxTurns: 10,
    contract: Contract,
    addDirs: [],
    session: { mode: "new", id: SESSION_ID, name: "run-1-coder-1" },
    timeoutMs: 10_000,
  };
  const events: CliEvent[] = [];
  return { fake, executor, request, events, onEvent: (e: CliEvent) => void events.push(e) };
}

describe("ClaudeCliExecutor", () => {
  test("executor returns session id, usage and the validated contract output from the result line", async () => {
    const { executor, request, events, onEvent } = setup({
      lines: [lines.init(), lines.assistantText("working"), lines.result({ structured_output: { status: "done", summary: "ok" } })],
    });
    const sessions: string[] = [];
    const result = await executor.run(request, { signal: new AbortController().signal, onEvent, onSessionId: (id) => void sessions.push(id) });
    expect(result.outcome).toBe("success");
    expect(result.validated).toEqual({ status: "done", summary: "ok" });
    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.costUsd).toBe(0.0123);
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    expect(result.exitCode).toBe(0);
    expect(sessions).toEqual([SESSION_ID]);
    expect(events.map((e) => e.type)).toEqual(["cli.system.init", "cli.assistant", "cli.result.success"]);
  });

  test("executor reports error_structured_output when the output does not match the contract", async () => {
    const { executor, request, onEvent } = setup({ lines: [lines.init(), lines.result({ structured_output: { status: "maybe" } })] });
    const result = await executor.run(request, { signal: new AbortController().signal, onEvent });
    expect(result.outcome).toBe("error_structured_output");
    expect(result.validationIssues?.length).toBeGreaterThan(0);
  });

  test("executor reports error_structured_output when a successful result has no structured output", async () => {
    const { executor, request, onEvent } = setup({ lines: [lines.init(), lines.result()] });
    expect((await executor.run(request, { signal: new AbortController().signal, onEvent })).outcome).toBe("error_structured_output");
  });

  test("executor reports error_max_turns from the result subtype", async () => {
    const { executor, request, onEvent } = setup({
      lines: [lines.init(), lines.result({ subtype: "error_max_turns", is_error: true })],
      exitCode: 1,
    });
    expect((await executor.run(request, { signal: new AbortController().signal, onEvent })).outcome).toBe("error_max_turns");
  });

  test("executor reports error with the stderr tail when the process exits non-zero without a result", async () => {
    const { executor, request, onEvent } = setup({ lines: [lines.init()], stderrLines: ["boom: not logged in"], exitCode: 1 });
    const result = await executor.run(request, { signal: new AbortController().signal, onEvent });
    expect(result.outcome).toBe("error");
    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toContain("not logged in");
  });

  test("executor reports interrupted when the child exits 143 after abort", async () => {
    const { executor, request, onEvent } = setup({ lines: [lines.init()], hangAfterLine: 1, ignoreSigint: true }, { killGraceMs: 100 });
    const controller = new AbortController();
    const running = executor.run(request, {
      signal: controller.signal,
      onEvent: (e) => {
        onEvent(e);
        if (e.type === "cli.system.init") controller.abort();
      },
    });
    const result = await running;
    expect(result.outcome).toBe("interrupted");
    expect(result.exitCode === 143 || result.signal === "SIGTERM").toBe(true);
  });

  test("executor reports timeout when the run exceeds timeoutMs", async () => {
    const { executor, request, onEvent } = setup({ lines: [lines.init()], hangAfterLine: 1 });
    const result = await executor.run({ ...request, timeoutMs: 300 }, { signal: new AbortController().signal, onEvent });
    expect(result.outcome).toBe("timeout");
  });

  test("executor spawns with CLAUDE_CONFIG_DIR set and without ANTHROPIC_API_KEY", async () => {
    const { executor, request, fake, onEvent } = setup({ lines: [lines.init(), lines.result({ structured_output: { status: "done", summary: "" } })] });
    await executor.run(request, { signal: new AbortController().signal, onEvent });
    const [invocation] = fake.invocations();
    expect(invocation?.env.CLAUDE_CONFIG_DIR).toBe("/tmp/handoff-claude-config");
    expect(invocation?.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-test");
    expect(invocation?.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(invocation?.cwd).toBe(realpath(request.cwd));
  });

  test("executor writes the context packet file and passes it with --append-system-prompt-file", async () => {
    const { executor, request, fake, onEvent } = setup({ lines: [lines.init(), lines.result({ structured_output: { status: "done", summary: "" } })] });
    await executor.run(request, { signal: new AbortController().signal, onEvent });
    const argv = fake.invocations()[0]!.argv;
    const file = argv[argv.indexOf("--append-system-prompt-file") + 1]!;
    expect(file.startsWith(request.stagingDir)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("# Task\nWrite a file.");
    expect(argv.slice(0, 2)).toEqual(["-p", "Do the task."]);
    expect(JSON.parse(argv[argv.indexOf("--json-schema") + 1]!)).toMatchObject({ type: "object", required: ["status", "summary"] });
  });

  test("executor lets the fake binary edit files in the working directory", async () => {
    const { executor, request, onEvent } = setup({
      edits: [{ path: "hello.txt", content: "hi" }],
      lines: [lines.init(), lines.result({ structured_output: { status: "done", summary: "" } })],
    });
    execFileSync("git", ["init", "-q"], { cwd: request.cwd });
    await executor.run(request, { signal: new AbortController().signal, onEvent });
    expect(existsSync(join(request.cwd, "hello.txt"))).toBe(true);
  });
});

function realpath(p: string) {
  return execFileSync("realpath", [p]).toString().trim();
}
