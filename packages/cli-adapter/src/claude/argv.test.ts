import { describe, expect, test } from "vitest";
import { ancestorInstructionExcludes, buildClaudeArgv } from "./argv.ts";
import type { ClaudeArgvInput } from "./argv.ts";

const base: ClaudeArgvInput = {
  prompt: "Implement the plan.",
  jsonSchema: { type: "object" },
  allowedTools: ["Read", "Edit", "Bash(git *)"],
  maxTurns: 40,
  systemPromptFile: "/tmp/stage/context.md",
  addDirs: [],
  session: { mode: "new", id: "11111111-2222-4333-8444-555555555555", name: "run-1-coder-1" },
};

const flagValue = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];

describe("buildClaudeArgv", () => {
  test("buildClaudeArgv never emits --bare", () => {
    expect(buildClaudeArgv(base)).not.toContain("--bare");
    expect(buildClaudeArgv({ ...base, session: { mode: "resume", id: "x" }, mcpConfigPath: "/m.json", addDirs: ["/s"] })).not.toContain(
      "--bare",
    );
  });

  test("buildClaudeArgv puts the prompt directly after -p", () => {
    expect(buildClaudeArgv(base).slice(0, 2)).toEqual(["-p", "Implement the plan."]);
  });

  test("buildClaudeArgv refuses a prompt that would parse as a flag", () => {
    expect(() => buildClaudeArgv({ ...base, prompt: "--help" })).toThrow(/prompt/);
  });

  test("buildClaudeArgv includes stream-json, json-schema, acceptEdits, permission-prompts none, strict-mcp-config and disableAllHooks", () => {
    const argv = buildClaudeArgv(base);
    expect(flagValue(argv, "--output-format")).toBe("stream-json");
    expect(argv).toContain("--verbose");
    expect(JSON.parse(flagValue(argv, "--json-schema")!)).toEqual({ type: "object" });
    expect(flagValue(argv, "--permission-mode")).toBe("acceptEdits");
    expect(flagValue(argv, "--permission-prompts")).toBe("none");
    expect(argv).toContain("--strict-mcp-config");
    expect(JSON.parse(flagValue(argv, "--settings")!)).toEqual({ disableAllHooks: true, showThinkingSummaries: true });
    expect(flagValue(argv, "--allowedTools")).toBe("Read,Edit,Bash(git *)");
    expect(flagValue(argv, "--max-turns")).toBe("40");
    expect(flagValue(argv, "--append-system-prompt-file")).toBe("/tmp/stage/context.md");
  });

  test("buildClaudeArgv sets the session id and name for a new session", () => {
    const argv = buildClaudeArgv(base);
    expect(flagValue(argv, "--session-id")).toBe(base.session.id);
    expect(flagValue(argv, "--name")).toBe("run-1-coder-1");
    expect(argv).not.toContain("--resume");
  });

  test("buildClaudeArgv passes --resume instead of --session-id and --name when resuming", () => {
    const argv = buildClaudeArgv({ ...base, session: { mode: "resume", id: "abc" } });
    expect(flagValue(argv, "--resume")).toBe("abc");
    expect(argv).not.toContain("--session-id");
    expect(argv).not.toContain("--name");
  });

  test("buildClaudeArgv adds mcp config, add-dirs and model only when given", () => {
    expect(buildClaudeArgv(base)).not.toContain("--mcp-config");
    const argv = buildClaudeArgv({ ...base, mcpConfigPath: "/s/mcp.json", addDirs: ["/s", "/t"], model: "opus" });
    expect(flagValue(argv, "--mcp-config")).toBe("/s/mcp.json");
    expect(argv.filter((a) => a === "--add-dir")).toHaveLength(2);
    expect(flagValue(argv, "--model")).toBe("opus");
  });

  test("buildClaudeArgv sets the effort only when given", () => {
    expect(buildClaudeArgv(base)).not.toContain("--effort");
    expect(flagValue(buildClaudeArgv({ ...base, effort: "xhigh" }), "--effort")).toBe("xhigh");
  });

  test("buildClaudeArgv passes claudeMdExcludes in --settings only when given", () => {
    const argv = buildClaudeArgv({ ...base, claudeMdExcludes: ["/a/CLAUDE.md"] });
    expect(JSON.parse(flagValue(argv, "--settings")!)).toEqual({ disableAllHooks: true, showThinkingSummaries: true, claudeMdExcludes: ["/a/CLAUDE.md"] });
  });

  test("buildClaudeArgv never disables session persistence", () => {
    expect(buildClaudeArgv(base)).not.toContain("--no-session-persistence");
  });
});

test("buildClaudeArgv passes subagent definitions as --agents JSON only when given", () => {
  expect(buildClaudeArgv(base)).not.toContain("--agents");
  const agents = { explorer: { description: "Reads code", prompt: "Explore.", tools: ["Read"] } };
  const argv = buildClaudeArgv({ ...base, agents });
  expect(JSON.parse(argv[argv.indexOf("--agents") + 1]!)).toEqual(agents);
});

describe("ancestorInstructionExcludes", () => {
  test("excludes instruction files in every ancestor of the working directory", () => {
    const excludes = ancestorInstructionExcludes("/home/me/handoff/.handoff/worktrees/run-1");
    for (const dir of ["/home/me/handoff/.handoff/worktrees", "/home/me/handoff", "/home/me", "/home"]) {
      expect(excludes).toEqual(
        expect.arrayContaining([`${dir}/CLAUDE.md`, `${dir}/CLAUDE.local.md`, `${dir}/.claude/CLAUDE.md`, `${dir}/.claude/rules/**`]),
      );
    }
    expect(excludes).toEqual(expect.arrayContaining(["/CLAUDE.md", "/.claude/rules/**"]));
  });

  test("keeps the working directory's own instruction files", () => {
    const excludes = ancestorInstructionExcludes("/home/me/work/");
    expect(excludes.some((p) => p.startsWith("/home/me/work/"))).toBe(false);
    expect(excludes).toContain("/home/me/CLAUDE.md");
  });
});

test("claude returns thinking summaries, so the dashboard can show what an agent thought", () => {
  const argv = buildClaudeArgv(base);
  const settings = JSON.parse(argv[argv.indexOf("--settings") + 1]!) as Record<string, unknown>;
  expect(settings.showThinkingSummaries).toBe(true);
});
