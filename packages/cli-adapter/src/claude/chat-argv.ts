import type { CliSession } from "../types.ts";

export type ClaudeChatArgvInput = {
  prompt: string;
  systemPromptFile: string;
  mcpConfigPath: string;
  /** Tools that run without asking: the assistant's read tools. Every other tool goes to the permission prompt tool. */
  allowedTools: string[];
  permissionPromptTool: string;
  maxTurns: number;
  model?: string;
  effort?: string;
  /** Absolute path globs for the CLI's claudeMdExcludes setting. */
  claudeMdExcludes: string[];
  session: CliSession;
};

/**
 * Builds argv for one turn of the dashboard's assistant: `claude -p` streaming its reply token by token,
 * with no built-in tools (no shell, files or web), only handoff's MCP tools from `mcpConfigPath`, the
 * read ones allowed and every other one put to the person through the permission prompt tool. Never
 * emits --bare: bare mode ignores the subscription login.
 */
export function buildClaudeChatArgv(input: ClaudeChatArgvInput): string[] {
  if (input.prompt.trimStart().startsWith("-")) throw new Error("prompt must not start with '-', it would be parsed as a flag");
  const argv = [
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    input.mcpConfigPath,
    "--allowedTools",
    input.allowedTools.join(","),
    "--permission-prompt-tool",
    input.permissionPromptTool,
    "--permission-mode",
    "default",
    "--max-turns",
    String(input.maxTurns),
    "--append-system-prompt-file",
    input.systemPromptFile,
    "--settings",
    JSON.stringify({ disableAllHooks: true, claudeMdExcludes: input.claudeMdExcludes, attribution: { commit: "", pr: "", sessionUrl: false } }),
  ];
  if (input.model) argv.push("--model", input.model);
  if (input.effort) argv.push("--effort", input.effort);
  if (input.session.mode === "new") argv.push("--session-id", input.session.id, "--name", input.session.name);
  else argv.push("--resume", input.session.id);
  return argv;
}
