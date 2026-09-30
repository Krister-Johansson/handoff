import { expect, test } from "vitest";
import { toActivity } from "./activity";

const assistant = (seq: number, ...content: unknown[]) => ({ seq, type: "cli.assistant", payload: { type: "assistant", message: { content } } });
const user = (seq: number, ...content: unknown[]) => ({ seq, type: "cli.user", payload: { type: "user", message: { content } } });

test("messages, thinking and tool calls become a timeline, with each tool's result on its call", () => {
  const { items, stats } = toActivity([
    { seq: 1, type: "cli.system.init", payload: { model: "claude-fable-5-1" } },
    assistant(2, { type: "thinking", thinking: "" }),
    assistant(3, { type: "thinking", thinking: "The docs say to scaffold into a temp dir." }),
    assistant(4, { type: "text", text: "I'll read the docs first." }),
    assistant(5, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/w/docs/architecture.md" } }),
    user(6, { type: "tool_result", tool_use_id: "t1", content: "# Architecture" }),
    assistant(7, { type: "tool_use", id: "t2", name: "mcp__context7__query-docs", input: { query: "create command flags" } }),
    user(8, { type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "no such library" }], is_error: true }),
    { seq: 9, type: "cli.system.thinking_tokens", payload: { estimated_tokens: 1750 } },
    { seq: 10, type: "cli.result.success", payload: { num_turns: 4, total_cost_usd: 0.42 } },
  ]);
  expect(items).toEqual([
    { kind: "thinking", key: "3:0", text: "The docs say to scaffold into a temp dir." },
    { kind: "message", key: "4:0", text: "I'll read the docs first." },
    { kind: "tool", key: "5:0", id: "t1", name: "Read", target: "/w/docs/architecture.md", result: "# Architecture", error: false },
    { kind: "tool", key: "7:0", id: "t2", name: "context7 · query-docs", target: "create command flags", result: "no such library", error: true },
  ]);
  expect(stats).toEqual({ model: "claude-fable-5-1", tools: 2, thinkingTokens: 1750, turns: 4, costUsd: 0.42 });
});

test("a tool still running has no result yet", () => {
  const { items } = toActivity([assistant(1, { type: "tool_use", id: "t1", name: "Bash", input: { command: "pnpm test" } })]);
  expect(items).toEqual([{ kind: "tool", key: "1:0", id: "t1", name: "Bash", target: "pnpm test" }]);
});

test("paths inside a run's worktree are shown relative to it", () => {
  const wt = "/Users/k/Project/handoff/.handoff/worktrees/6fa020e8-5523-4d3a-9bd0-ee00b534c627";
  const { items } = toActivity([
    assistant(1, { type: "tool_use", id: "a", name: "Read", input: { file_path: `${wt}/docs/features.md` } }),
    assistant(2, { type: "tool_use", id: "b", name: "Bash", input: { command: `cd ${wt} && pnpm test` } }),
    assistant(3, { type: "tool_use", id: "c", name: "Glob", input: { pattern: "**/*", path: wt } }),
  ]);
  expect(items.map((i) => (i.kind === "tool" ? i.target : undefined))).toEqual(["docs/features.md", "cd . && pnpm test", "**/*"]);
});
