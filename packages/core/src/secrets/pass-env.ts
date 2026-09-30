/** The worker's own credentials. A graph can never pass these to commands the agent's code runs in. */
export const RESERVED_ENV_NAMES = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY_PATH",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
] as const;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Why a passEnv value cannot be used, or undefined when it can. Graphs store names only, never values. */
export function passEnvProblem(names: unknown): string | undefined {
  if (!Array.isArray(names)) return "passEnv must be a list of variable names";
  for (const name of names) {
    if (typeof name !== "string" || !ENV_NAME.test(name)) return `passEnv: ${String(name)} is not a variable name`;
    if ((RESERVED_ENV_NAMES as readonly string[]).includes(name)) return `passEnv: ${name} is one of handoff's own secrets and cannot be passed to commands`;
  }
  return undefined;
}

/** The named variables that are set in `base`. */
export function pickEnv(names: readonly string[], base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = base[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}
