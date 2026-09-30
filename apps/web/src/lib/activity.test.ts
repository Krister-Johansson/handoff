import { expect, test } from "vitest";
import { toActivity, toChat } from "./activity";

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

test("consecutive tool calls form one step, summarised by what they did", () => {
  const { items } = toActivity([
    assistant(1, { type: "text", text: "Reading first." }),
    assistant(2, { type: "tool_use", id: "a", name: "Read", input: { file_path: "a.md" } }),
    assistant(3, { type: "tool_use", id: "b", name: "Read", input: { file_path: "b.md" } }),
    assistant(4, { type: "tool_use", id: "c", name: "Bash", input: { command: "pnpm test" } }),
    assistant(5, { type: "tool_use", id: "d", name: "mcp__context7__query-docs", input: { query: "x" } }),
    assistant(6, { type: "tool_use", id: "e", name: "mcp__context7__query-docs", input: { query: "y" } }),
    assistant(7, { type: "text", text: "Now the plan." }),
    assistant(8, { type: "tool_use", id: "f", name: "Edit", input: { file_path: "c.ts" } }),
  ]);
  const chat = toChat(items);
  expect(chat.map((e) => (e.kind === "tools" ? `tools: ${e.summary}` : `${e.kind}: ${e.text}`))).toEqual([
    "message: Reading first.",
    "tools: Read 2 files, ran a command, used context7 twice",
    "message: Now the plan.",
    "tools: Edited a file",
  ]);
});

test("the CLI's own tools do not count as work in a step's summary", () => {
  const { items } = toActivity([
    assistant(1, { type: "tool_use", id: "a", name: "ToolSearch", input: { query: "select:x" } }),
    assistant(2, { type: "tool_use", id: "b", name: "Read", input: { file_path: "a.md" } }),
    assistant(3, { type: "tool_use", id: "c", name: "StructuredOutput", input: {} }),
  ]);
  expect(toChat(items).map((e) => (e.kind === "tools" ? e.summary : ""))).toEqual(["Read a file"]);
  const { items: only } = toActivity([assistant(1, { type: "tool_use", id: "c", name: "StructuredOutput", input: {} })]);
  expect(toChat(only).map((e) => (e.kind === "tools" ? e.summary : ""))).toEqual(["Prepared its answer"]);
});

const denial = (what: string) =>
  `Permission for this tool use was denied. It requires approval, and this session has no approval surface. What required approval: ${what}`;

test("a denied tool call says what was denied and which rules would allow it", () => {
  const { items } = toActivity([
    assistant(1, { type: "tool_use", id: "a", name: "Bash", input: { command: "git log -5 && gh issue view 1" } }),
    user(2, { type: "tool_result", tool_use_id: "a", is_error: true, content: denial("This Bash command contains multiple operations. The following part requires approval: git log --format='%h' -5 && gh issue view 1 --json state 2>&1") }),
    assistant(3, { type: "tool_use", id: "b", name: "Bash", input: { command: "xxd f | head; node --test" } }),
    user(4, { type: "tool_result", tool_use_id: "b", is_error: true, content: denial("This Bash command contains multiple operations. The following parts require approval: xxd, head; node --test 2>&1") }),
    assistant(5, { type: "tool_use", id: "c", name: "Bash", input: { command: "echo {a,b}" } }),
    user(6, { type: "tool_result", tool_use_id: "c", is_error: true, content: denial("Brace expansion (unquoted `{` in concatenation with `,`/`..`)") }),
    assistant(7, { type: "tool_use", id: "d", name: "WebFetch", input: { url: "https://example.com" } }),
    user(8, { type: "tool_result", tool_use_id: "d", is_error: true, content: denial("WebFetch(https://example.com)") }),
  ]);
  const denied = items.map((i) => (i.kind === "tool" ? i.denied : undefined));
  expect(denied[0]).toEqual({ reason: expect.stringContaining("git log"), rules: ["Bash(git log *)", "Bash(gh issue *)"] });
  expect(denied[1]!.rules).toEqual(["Bash(xxd *)", "Bash(head *)", "Bash(node --test *)"]);
  expect(denied[2]).toEqual({ reason: "Brace expansion (unquoted `{` in concatenation with `,`/`..`)", rules: [] });
  expect(denied[3]!.rules).toEqual(["WebFetch"]);
  expect(toChat(items).find((e) => e.kind === "tools")).toMatchObject({ denied: 4 });
});
