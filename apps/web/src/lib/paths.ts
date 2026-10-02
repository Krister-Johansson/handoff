import type { PlanStatus } from "@handoff/github";
import { PROJECT_SECTIONS, type PlanViewName, type ProjectSection } from "./project-tab";

/** A project's page: its Overview without a section, else the section's route. */
export const projectPath = (projectId: string, section?: ProjectSection) => `/projects/${projectId}${section ? `/${section}` : ""}`;

/**
 * The project and its section a dashboard path is under, such as p1 and runs for /projects/p1/runs/r1;
 * undefined outside a project. The section is undefined on the project's Overview.
 */
export function projectAt(pathname: string): { projectId: string; section?: ProjectSection } | undefined {
  const [, root, projectId, section] = pathname.split("/");
  if (root !== "projects" || !projectId) return undefined;
  return { projectId, section: (PROJECT_SECTIONS as readonly string[]).includes(section ?? "") ? (section as ProjectSection) : undefined };
}

/** A project's Plan page, with the view (the tree unless given), an epic and statuses to narrow it to. */
export function planPath(projectId: string, opts: { view?: PlanViewName; epic?: number; status?: PlanStatus[] } = {}) {
  const query = [
    opts.view && opts.view !== "tree" ? `view=${opts.view}` : undefined,
    opts.epic !== undefined ? `epic=${opts.epic}` : undefined,
    opts.status?.length ? `status=${opts.status.map(encodeURIComponent).join(",")}` : undefined,
  ].filter(Boolean);
  return `/projects/${projectId}/plan${query.length ? `?${query.join("&")}` : ""}`;
}

/** A run's page, under the project it belongs to. */
export const runPath = (projectId: string, runId: string) => `/projects/${projectId}/runs/${runId}`;

/** A review question's page, under its run. */
export const reviewPath = (projectId: string, runId: string, questionId: string) => `${runPath(projectId, runId)}/review/${questionId}`;

/** A Try it gate's page, where a person checks the run's app against its acceptance criteria. */
export const tryPath = (projectId: string, runId: string, questionId: string) => `${runPath(projectId, runId)}/try/${questionId}`;
