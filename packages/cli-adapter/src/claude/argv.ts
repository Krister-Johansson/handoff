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
  agents?: Record<string, AgentDefinition>;
};

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
    JSON.stringify({ disableAllHooks: true }),
    "--strict-mcp-config",
  ];
  if (input.mcpConfigPath) argv.push("--mcp-config", input.mcpConfigPath);
  for (const dir of input.addDirs) argv.push("--add-dir", dir);
  if (input.model) argv.push("--model", input.model);
  if (input.agents && Object.keys(input.agents).length > 0) argv.push("--agents", JSON.stringify(input.agents));
  if (input.session.mode === "new") argv.push("--session-id", input.session.id, "--name", input.session.name);
  else argv.push("--resume", input.session.id);
  return argv;
}
