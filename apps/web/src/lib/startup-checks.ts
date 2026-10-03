/**
 * What the dashboard says at startup when it has no GitHub credential: a token, or a GitHub App's id
 * and private key, as gitHubFromEnv reads them. Undefined when one is set.
 */
export function gitHubCredentialsWarning(env: Record<string, string | undefined>): string | undefined {
  if (env.GITHUB_TOKEN || (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY_PATH)) return undefined;
  return "handoff: No GitHub credentials are set. Set GITHUB_TOKEN, or GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH, and restart the dashboard. Until then everything it reads from or writes to GitHub fails.";
}
