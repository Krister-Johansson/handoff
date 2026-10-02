import "server-only";
import { gitHubFromEnv, OctokitGitHub, OctokitProjects, projectsFromEnv, type GitHubPort, type ProjectsPort } from "@handoff/github";

const globalForGitHub = globalThis as unknown as { handoffGitHub?: GitHubPort | null; handoffProjects?: ProjectsPort | null };

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

/**
 * The plan on GitHub Projects for the dashboard: a port from GITHUB_TOKEN, undefined without one (a
 * GitHub App cannot reach a user-owned Project). Cached like getGitHub.
 */
export function getProjects(): ProjectsPort | undefined {
  const cached = globalForGitHub.handoffProjects;
  if (cached === undefined || (cached !== null && !(cached instanceof OctokitProjects))) globalForGitHub.handoffProjects = projectsFromEnv() ?? null;
  return globalForGitHub.handoffProjects ?? undefined;
}
