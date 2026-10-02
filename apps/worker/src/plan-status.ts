import type { ProjectsPort } from "@handoff/github";

const FIX = "Run gh auth refresh -s project, then set GITHUB_TOKEN=$(gh auth token).";
const off = (why: string) => `The plan on GitHub Projects is off: ${why}. Runs record plan.skipped instead of moving their tasks. ${FIX}`;

/**
 * The Projects port the worker writes task status with, checked once at start. Without GITHUB_TOKEN,
 * or with a token that is not classic or lacks the project scope, it says so in one log line and
 * returns undefined, so runs record plan.skipped and go on.
 */
export async function planAccess(projects: ProjectsPort | undefined, log: (message: string) => void): Promise<ProjectsPort | undefined> {
  if (!projects) {
    log(off("GITHUB_TOKEN is not set, and a GitHub App cannot reach a user-owned Project"));
    return undefined;
  }
  // GitHub unreachable at start is no reason to turn the plan off: each write still records plan.skipped when it fails.
  const scopes = await projects.scopes().catch((error: unknown) => {
    log(`Could not read the scopes of GITHUB_TOKEN (${error instanceof Error ? error.message : String(error)}); status writes to the plan are tried and skipped when they fail.`);
    return { project: true, classic: true };
  });
  if (!scopes.classic) {
    log(off("GITHUB_TOKEN is not a classic token, and only a classic token with the project scope reaches a user-owned Project"));
    return undefined;
  }
  if (!scopes.project) {
    log(off("GITHUB_TOKEN lacks the project scope"));
    return undefined;
  }
  return projects;
}
