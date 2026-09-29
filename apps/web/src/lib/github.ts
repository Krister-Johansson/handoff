import "server-only";
import { gitHubFromEnv, type GitHubPort } from "@handoff/github";

const globalForGitHub = globalThis as unknown as { handoffGitHub?: GitHubPort | null };

/** GitHub client for live PR state in the dashboard; null when no credential is configured. */
export function getGitHub(): GitHubPort | undefined {
  if (globalForGitHub.handoffGitHub === undefined) globalForGitHub.handoffGitHub = gitHubFromEnv() ?? null;
  return globalForGitHub.handoffGitHub ?? undefined;
}
