import type { PlanStatus } from "@handoff/github";
import type { RunFilter } from "./plan/filters";
import type { Zoom } from "./plan/timeline-scale";
import { PROJECT_SECTIONS, type PlanViewName, type ProjectSection } from "./project-tab";

/** Settings, Projects: where projects are added, edited and deleted. */
export const PROJECTS_SETTINGS_PATH = "/settings?tab=projects";

/** A project's page: its Home page without a section, else the section's route. */
export const projectPath = (projectId: string, section?: ProjectSection) => `/projects/${projectId}${section ? `/${section}` : ""}`;

/** An issue's page in handoff: a task, a story, an epic or an issue outside the plan. */
export const issuePath = (projectId: string, number: number) => `/projects/${projectId}/issues/${number}`;

/**
 * The project and its section a dashboard path is under, such as p1 and runs for /projects/p1/runs/r1;
 * undefined outside a project. The section is undefined on the project's Home page.
 */
export function projectAt(pathname: string): { projectId: string; section?: ProjectSection } | undefined {
  const [, root, projectId, section] = pathname.split("/");
  if (root !== "projects" || !projectId) return undefined;
  return { projectId, section: (PROJECT_SECTIONS as readonly string[]).includes(section ?? "") ? (section as ProjectSection) : undefined };
}

/**
 * A project's Plan page, with the view (the tree unless given), an epic (or the unplanned issues),
 * statuses and a run filter to narrow it to, and the timeline's zoom.
 */
export function planPath(projectId: string, opts: { view?: PlanViewName; epic?: number | "unplanned"; status?: PlanStatus[]; run?: RunFilter; zoom?: Zoom } = {}) {
  const query = [
    opts.view && opts.view !== "tree" ? `view=${opts.view}` : undefined,
    opts.epic !== undefined ? `epic=${opts.epic}` : undefined,
    opts.status?.length ? `status=${opts.status.map(encodeURIComponent).join(",")}` : undefined,
    opts.run && opts.run !== "any" ? `run=${opts.run}` : undefined,
    opts.view === "timeline" && opts.zoom ? `zoom=${opts.zoom}` : undefined,
  ].filter(Boolean);
  return `/projects/${projectId}/plan${query.length ? `?${query.join("&")}` : ""}`;
}

// A run's, a review's and a Try it page's paths live in core, where the engine writes notification links with them.
export { reviewPath, runPath, tryPath } from "@handoff/core/paths";
