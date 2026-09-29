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
