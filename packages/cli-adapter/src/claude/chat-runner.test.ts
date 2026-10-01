import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fakeClaude, fakeClaudeBin, lines, SESSION_ID, type FakeScenario } from "../testing/fake-claude.ts";
import { ClaudeChatRunner, type ChatEvent, type ChatTurnRequest } from "./chat-runner.ts";

const delta = (text: string) => ({ type: "stream_event", session_id: SESSION_ID, parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
const toolUse = (id: string, name: string, input: unknown) => ({
  type: "assistant",
  session_id: SESSION_ID,
  parent_tool_use_id: null,
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
});
const toolResult = (id: string, text: string, isError = false) => ({
  type: "user",
  session_id: SESSION_ID,
  parent_tool_use_id: null,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }], is_error: isError }] },
});

function setup(scenario: FakeScenario) {
  const fake = fakeClaude(scenario);
  const runner = new ClaudeChatRunner({
    command: { file: process.execPath, prefixArgs: [fakeClaudeBin] },
    oauthToken: "sk-ant-oat01-test",
    configDir: "/tmp/handoff-claude-config-assistant",
    baseEnv: { ...process.env, ANTHROPIC_API_KEY: "must-not-leak", ...fake.env },
    passthroughEnv: ["FAKE_CLAUDE_SCENARIO", "FAKE_CLAUDE_RECORD"],
    killGraceMs: 200,
    trackIntervalMs: 50,
  });
  const request: ChatTurnRequest = {
    prompt: "What needs me?",
    systemPrompt: "You operate the handoff dashboard.",
    cwd: mkdtempSync(join(tmpdir(), "assistant-cwd-")),
    stagingDir: mkdtempSync(join(tmpdir(), "assistant-stage-")),
    mcpConfigPath: "/tmp/stage/mcp.json",
    allowedTools: ["mcp__handoff__list_inbox"],
    permissionPromptTool: "mcp__handoff__approve",
    maxTurns: 12,
    session: { mode: "new", id: SESSION_ID, name: "assistant-c1" },
    timeoutMs: 10_000,
  };
  const events: ChatEvent[] = [];
  return { fake, runner, request, events, onEvent: (e: ChatEvent) => void events.push(e) };
}

test("the chat runner delivers text deltas in order, then tool calls and results, then the result's session id and cost", async () => {
  const { runner, request, events, onEvent } = setup({
    lines: [
      lines.init(),
      delta("Let me "),
      delta("look."),
      toolUse("t1", "mcp__handoff__list_inbox", { project: "sandbox" }),
      toolResult("t1", '{"permissions":[]}'),
      delta(" Nothing needs you."),
      lines.result({ result: "Let me look. Nothing needs you.", total_cost_usd: 0.002 }),
    ],
  });
  const result = await runner.run(request, { signal: new AbortController().signal, onEvent });
  expect(events).toEqual([
    { type: "text", text: "Let me " },
    { type: "text", text: "look." },
    { type: "tool_call", id: "t1", name: "mcp__handoff__list_inbox", input: { project: "sandbox" } },
    { type: "tool_result", id: "t1", content: '{"permissions":[]}', isError: false },
    { type: "text", text: " Nothing needs you." },
  ]);
  expect(result).toMatchObject({ outcome: "success", text: "Let me look. Nothing needs you.", sessionId: SESSION_ID, costUsd: 0.002 });
});

test("stopping a turn sends SIGINT and reports interrupted with the text so far", async () => {
  const { runner, request, onEvent } = setup({ lines: [lines.init(), delta("Working on "), delta("it")], hangAfterLine: 3 });
  const controller = new AbortController();
  const done = runner.run(request, { signal: controller.signal, onEvent: (e) => (onEvent(e), e.type === "text" && e.text === "it" && controller.abort()) });
  const result = await done;
  expect(result).toMatchObject({ outcome: "interrupted", text: "Working on it" });
});

test("the runner spawns with the assistant config dir and without ANTHROPIC_API_KEY", async () => {
  const { fake, runner, request, onEvent } = setup({ lines: [lines.init(), lines.result()] });
  await runner.run(request, { signal: new AbortController().signal, onEvent });
  const [invocation] = fake.invocations();
  expect(invocation!.env.CLAUDE_CONFIG_DIR).toBe("/tmp/handoff-claude-config-assistant");
  expect(invocation!.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(realpathSync(invocation!.cwd)).toBe(realpathSync(request.cwd));
  expect(invocation!.argv).toContain("--include-partial-messages");
  expect(invocation!.argv).not.toContain("--bare");
});

test("an api_retry with authentication_failed ends the turn with a readable error", async () => {
  const { runner, request, onEvent } = setup({
    lines: [lines.init(), { type: "system", subtype: "api_retry", session_id: SESSION_ID, attempt: 1, error: "authentication_failed" }],
    hangAfterLine: 2,
  });
  const result = await runner.run(request, { signal: new AbortController().signal, onEvent });
  expect(result.outcome).toBe("error");
  expect(result.errorMessage).toMatch(/claude setup-token/);
});
