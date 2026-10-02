import type { PlanStatus } from "@handoff/github";
import type { RunFilter } from "./plan/filters";
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

/** A project's Plan page, with the view (the tree unless given), an epic (or the unplanned issues), statuses and a run filter to narrow it to. */
export function planPath(projectId: string, opts: { view?: PlanViewName; epic?: number | "unplanned"; status?: PlanStatus[]; run?: RunFilter } = {}) {
  const query = [
    opts.view && opts.view !== "tree" ? `view=${opts.view}` : undefined,
    opts.epic !== undefined ? `epic=${opts.epic}` : undefined,
    opts.status?.length ? `status=${opts.status.map(encodeURIComponent).join(",")}` : undefined,
    opts.run && opts.run !== "any" ? `run=${opts.run}` : undefined,
  ].filter(Boolean);
  return `/projects/${projectId}/plan${query.length ? `?${query.join("&")}` : ""}`;
}

// A run's, a review's and a Try it page's paths live in core, where the engine writes notification links with them.
export { reviewPath, runPath, tryPath } from "@handoff/core/paths";
