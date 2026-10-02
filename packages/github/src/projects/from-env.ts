import { OctokitProjects } from "./octokit-projects.ts";
import type { ProjectsPort } from "./types.ts";

/**
 * A ProjectsPort from GITHUB_TOKEN; undefined without one. A GitHub App cannot reach a user-owned Project,
 * so the App settings alone give no port. Whether the token has the `project` scope is `scopes()`'s answer.
 */
export function projectsFromEnv(env: Record<string, string | undefined> = process.env): ProjectsPort | undefined {
  return env.GITHUB_TOKEN ? OctokitProjects.withToken(env.GITHUB_TOKEN) : undefined;
}
