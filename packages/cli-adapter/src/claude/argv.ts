import { dirname, resolve } from "node:path";
import type { AgentDefinition, CliSession } from "../types.ts";

export type ClaudeArgvInput = {
  prompt: string;
  jsonSchema: object;
  allowedTools: string[];
  maxTurns: number;
  systemPromptFile: string;
  mcpConfigPath?: string;
  addDirs: string[];
  session: CliSession;
  model?: string;
  /** Claude Code's --effort level. */
  effort?: string;
  agents?: Record<string, AgentDefinition>;
  /** Absolute path globs for the CLI's claudeMdExcludes setting. */
  claudeMdExcludes?: string[];
};

/**
 * Claude loads CLAUDE.md, CLAUDE.local.md, .claude/CLAUDE.md and .claude/rules from every
 * ancestor of its working directory. A worktree under handoff's own checkout or under the
 * home directory would pick up handoff's CLAUDE.md or ~/.claude/rules. These globs exclude
 * every strict ancestor, so only the target repository's own instructions load.
 */
export function ancestorInstructionExcludes(cwd: string): string[] {
  const excludes: string[] = [];
  let dir = dirname(resolve(cwd));
  for (;;) {
    const base = dir === "/" ? "" : dir;
    excludes.push(`${base}/CLAUDE.md`, `${base}/CLAUDE.local.md`, `${base}/.claude/CLAUDE.md`, `${base}/.claude/rules/**`);
    const parent = dirname(dir);
    if (parent === dir) return excludes;
    dir = parent;
  }
}

/**
 * Builds argv for `claude -p`. Never emits --bare: bare mode ignores the subscription login
 * (CLAUDE_CODE_OAUTH_TOKEN). See docs/adr/0003-claude-cli-subprocess.md.
 * The prompt is the positional argument directly after -p, because several flags take
 * space-separated values and would otherwise swallow it.
 */
export function buildClaudeArgv(input: ClaudeArgvInput): string[] {
  if (input.prompt.trimStart().startsWith("-")) {
    throw new Error("prompt must not start with '-', it would be parsed as a flag");
  }
  const argv = [
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    JSON.stringify(input.jsonSchema),
    "--permission-mode",
    "acceptEdits",
    "--permission-prompts",
    "none",
    "--allowedTools",
    input.allowedTools.join(","),
    "--max-turns",
    String(input.maxTurns),
    "--append-system-prompt-file",
    input.systemPromptFile,
    "--settings",
    // Thinking summaries instead of redacted blocks, so the dashboard can show what an agent thought.
    // No attribution: the CLI's default Co-Authored-By trailer overrides the repository's commit conventions.
    JSON.stringify({
      disableAllHooks: true,
      showThinkingSummaries: true,
      attribution: { commit: "", pr: "", sessionUrl: false },
      ...(input.claudeMdExcludes ? { claudeMdExcludes: input.claudeMdExcludes } : {}),
    }),
    "--strict-mcp-config",
  ];
  if (input.mcpConfigPath) argv.push("--mcp-config", input.mcpConfigPath);
  for (const dir of input.addDirs) argv.push("--add-dir", dir);
  if (input.model) argv.push("--model", input.model);
  if (input.effort) argv.push("--effort", input.effort);
  if (input.agents && Object.keys(input.agents).length > 0) argv.push("--agents", JSON.stringify(input.agents));
  if (input.session.mode === "new") argv.push("--session-id", input.session.id, "--name", input.session.name);
  else argv.push("--resume", input.session.id);
  return argv;
}
