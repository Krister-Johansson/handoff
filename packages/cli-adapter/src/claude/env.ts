const BASE_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TERM", "MCP_TIMEOUT"];

/**
 * Minimal environment for the claude child. Carries the subscription token and a dedicated config
 * dir; never ANTHROPIC_API_KEY (which would switch billing) or unrelated credentials.
 */
export function buildClaudeEnv(input: {
  oauthToken: string;
  configDir: string;
  base: Record<string, string | undefined>;
  passthrough?: string[];
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [...BASE_KEYS, ...(input.passthrough ?? [])]) {
    const value = input.base[key];
    if (value !== undefined) env[key] = value;
  }
  env.CLAUDE_CODE_OAUTH_TOKEN = input.oauthToken;
  env.CLAUDE_CONFIG_DIR = input.configDir;
  return env;
}

/**
 * The environment for one turn of the dashboard's assistant: the claude child's minimal environment,
 * with Claude Code's MCP discovery cache off. The assistant's MCP server has the same name and URL on
 * every turn while its tools follow the page the person has open, so a cached tool list would be stale.
 */
export function buildAssistantEnv(input: Parameters<typeof buildClaudeEnv>[0]): Record<string, string> {
  return { ...buildClaudeEnv(input), MCP_DISCOVERY_CACHE: "0" };
}
