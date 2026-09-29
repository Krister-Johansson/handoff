import { readFileSync } from "node:fs";
import { OctokitGitHub } from "./octokit-client.ts";
import type { GitHubPort } from "./types.ts";

/** A GitHubPort from GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_PATH, or GITHUB_TOKEN; undefined when neither is set. */
export function gitHubFromEnv(env: Record<string, string | undefined> = process.env): GitHubPort | undefined {
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY_PATH) {
    return OctokitGitHub.withApp({ appId: Number(env.GITHUB_APP_ID), privateKey: readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8") });
  }
  if (env.GITHUB_TOKEN) return OctokitGitHub.withToken(env.GITHUB_TOKEN);
  return undefined;
}
