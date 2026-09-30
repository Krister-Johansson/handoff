import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const fakeClaudeBin = fileURLToPath(new URL("./fake-claude/bin.mjs", import.meta.url));

export type FakeScenario = {
  lines?: unknown[];
  lineDelayMs?: number;
  stderrLines?: string[];
  exitCode?: number;
  edits?: { path: string; content: string }[];
  gitCommit?: string;
  hangAfterLine?: number;
  ignoreSigint?: boolean;
  chunkSplit?: boolean;
  /** Processes the fake starts and leaves running; `detached` puts one in its own session. */
  background?: { pidFile: string; detached?: boolean }[];
};

export type FakeInvocation = { argv: string[]; cwd: string; env: Record<string, string> };

/** Creates a scenario file and a record file; returns env vars for the fake binary and a reader for invocations. */
export function fakeClaude(scenario: FakeScenario, dir = mkdtempSync(join(tmpdir(), "fake-claude-"))) {
  const scenarioPath = join(dir, "scenario.json");
  const recordPath = join(dir, "record.jsonl");
  writeFileSync(scenarioPath, JSON.stringify(scenario));
  return {
    env: { FAKE_CLAUDE_SCENARIO: scenarioPath, FAKE_CLAUDE_RECORD: recordPath },
    invocations(): FakeInvocation[] {
      if (!existsSync(recordPath)) return [];
      return readFileSync(recordPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as FakeInvocation);
    },
  };
}

export const SESSION_ID = "11111111-2222-4333-8444-555555555555";

export const lines = {
  init: (extra: Record<string, unknown> = {}) => ({
    type: "system",
    subtype: "init",
    session_id: SESSION_ID,
    model: "claude-fable-5-1",
    tools: ["Read", "Edit"],
    mcp_servers: [],
    ...extra,
  }),
  assistantText: (text: string) => ({
    type: "assistant",
    session_id: SESSION_ID,
    parent_tool_use_id: null,
    message: { role: "assistant", content: [{ type: "text", text }] },
  }),
  result: (extra: Record<string, unknown> = {}) => ({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 3,
    result: "done",
    session_id: SESSION_ID,
    total_cost_usd: 0.0123,
    usage: { input_tokens: 100, output_tokens: 50 },
    permission_denials: [],
    ...extra,
  }),
};
