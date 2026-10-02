import type { ProjectsPort } from "@handoff/github";
import { PROJECTS_FIX } from "./plan-status.ts";

/**
 * Starts the scheduler when the worker has Projects access, since the scheduler reads Ready tasks
 * from the plan. Without it the worker logs once that the scheduler is off and how to turn access on;
 * the line before it, from planAccess, says what is wrong with the token.
 */
export function startSchedulerWith<H>(projects: ProjectsPort | undefined, start: (projects: ProjectsPort) => H, log: (message: string) => void): H | undefined {
  if (!projects) {
    log(`The scheduler is off: it reads Ready tasks from GitHub Projects, and the worker has no access to them. ${PROJECTS_FIX}`);
    return undefined;
  }
  return start(projects);
}
