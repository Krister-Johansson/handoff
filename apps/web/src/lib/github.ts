import "server-only";
import { gitHubFromEnv, OctokitGitHub, type GitHubPort } from "@handoff/github";

const globalForGitHub = globalThis as unknown as { handoffGitHub?: GitHubPort | null };

/**
 * GitHub client for the dashboard; undefined when no credential is configured. Cached on globalThis
 * so dev hot reloads keep one client, and replaced when a reload brought a new OctokitGitHub class
 * (an old instance would lack methods added since).
 */
export function getGitHub(): GitHubPort | undefined {
  const cached = globalForGitHub.handoffGitHub;
  if (cached === undefined || (cached !== null && !(cached instanceof OctokitGitHub))) globalForGitHub.handoffGitHub = gitHubFromEnv() ?? null;
  return globalForGitHub.handoffGitHub ?? undefined;
}
