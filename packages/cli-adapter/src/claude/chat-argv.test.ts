import { describe, expect, test } from "vitest";
import { buildClaudeChatArgv } from "./chat-argv.ts";

const base = {
  prompt: "What needs me?",
  systemPromptFile: "/tmp/stage/assistant.md",
  mcpConfigPath: "/tmp/stage/mcp.json",
  allowedTools: ["mcp__handoff__list_inbox", "mcp__handoff__get_run"],
  permissionPromptTool: "mcp__handoff__approve",
  maxTurns: 12,
  model: "sonnet",
  effort: "low",
  claudeMdExcludes: ["/CLAUDE.md"],
  session: { mode: "new" as const, id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "assistant-c1" },
};

const flagValue = (argv: string[], flag: string) => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};

describe("chat argv", () => {
  test("buildClaudeChatArgv never emits --bare", () => {
    expect(buildClaudeChatArgv(base)).not.toContain("--bare");
    expect(buildClaudeChatArgv({ ...base, session: { mode: "resume", id: "s1" } })).not.toContain("--bare");
  });

  test("it asks for stream-json with partial messages, removes built-in tools, allows only the named read tools and names the permission prompt tool", () => {
    const argv = buildClaudeChatArgv(base);
    expect(argv.slice(0, 2)).toEqual(["-p", "What needs me?"]);
    expect(flagValue(argv, "--output-format")).toBe("stream-json");
    expect(argv).toContain("--verbose");
    expect(argv).toContain("--include-partial-messages");
    expect(flagValue(argv, "--tools")).toBe("");
    expect(argv).toContain("--strict-mcp-config");
    expect(flagValue(argv, "--mcp-config")).toBe("/tmp/stage/mcp.json");
    expect(flagValue(argv, "--allowedTools")).toBe("mcp__handoff__list_inbox,mcp__handoff__get_run");
    expect(flagValue(argv, "--permission-prompt-tool")).toBe("mcp__handoff__approve");
    expect(flagValue(argv, "--permission-mode")).toBe("default");
    expect(flagValue(argv, "--max-turns")).toBe("12");
    expect(flagValue(argv, "--model")).toBe("sonnet");
    expect(flagValue(argv, "--effort")).toBe("low");
    expect(flagValue(argv, "--append-system-prompt-file")).toBe("/tmp/stage/assistant.md");
    expect(JSON.parse(flagValue(argv, "--settings")!)).toMatchObject({ disableAllHooks: true, claudeMdExcludes: ["/CLAUDE.md"] });
    // A chat answers in prose: no structured output contract.
    expect(argv).not.toContain("--json-schema");
  });

  test("it passes --session-id with --name on the first turn and --resume afterwards", () => {
    const first = buildClaudeChatArgv(base);
    expect([flagValue(first, "--session-id"), flagValue(first, "--name")]).toEqual(["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "assistant-c1"]);
    expect(first).not.toContain("--resume");
    const later = buildClaudeChatArgv({ ...base, session: { mode: "resume", id: "s1" } });
    expect(flagValue(later, "--resume")).toBe("s1");
    expect(later).not.toContain("--session-id");
  });

  test("it rejects a prompt that starts with a dash", () => {
    expect(() => buildClaudeChatArgv({ ...base, prompt: "--help" })).toThrow(/prompt/);
  });
});
