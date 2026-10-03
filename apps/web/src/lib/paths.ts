import type { PlanStatus } from "@handoff/github";
import type { AssigneeFilter, RunFilter } from "./plan/filters";
import type { Zoom } from "./plan/timeline-scale";
import { PROJECT_SECTIONS, type PlanViewName, type ProjectSection } from "./project-tab";
import type { RunsFilter } from "./run-status-filter";

/** Settings, Projects: where projects are added, edited and deleted. */
export const PROJECTS_SETTINGS_PATH = "/settings?tab=projects";

/** A project's page: its Home page without a section, else the section's route. */
export const projectPath = (projectId: string, section?: ProjectSection) => `/projects/${projectId}${section ? `/${section}` : ""}`;

/** A project's Runs page: every run, or the runs one status filter lists. */
export const runsPath = (projectId: string, status?: RunsFilter) => `/projects/${projectId}/runs${status ? `?status=${status}` : ""}`;

/** A graph in its editor: its latest version, or the version given, such as the one a run is pinned to. */
export const graphPath = (projectId: string, name: string, version?: number) =>
  `/projects/${projectId}/graphs/${encodeURIComponent(name)}${version === undefined ? "" : `?version=${version}`}`;

/** An issue's page in handoff: a task, a story, an epic or an issue outside the plan. */
export const issuePath = (projectId: string, number: number) => `/projects/${projectId}/issues/${number}`;

/**
 * The project and its section a dashboard path is under, such as p1 and runs for /projects/p1/runs/r1;
 * undefined outside a project. The section is undefined on the project's Home page. The graph editor,
 * /projects/<id>/graphs/<name>, is under project settings, where the project's graphs are listed.
 */
export function projectAt(pathname: string): { projectId: string; section?: ProjectSection } | undefined {
  const [, root, projectId, segment] = pathname.split("/");
  if (root !== "projects" || !projectId) return undefined;
  const section = segment === "graphs" ? "settings" : segment;
  return { projectId, section: (PROJECT_SECTIONS as readonly string[]).includes(section ?? "") ? (section as ProjectSection) : undefined };
}

/**
 * A project's Plan page, with the view (the tree unless given), an epic (or the unplanned issues),
 * statuses and a run filter to narrow it to, and the timeline's zoom.
 */
export function planPath(
  projectId: string,
  opts: { view?: PlanViewName; epic?: number | "unplanned"; status?: PlanStatus[]; run?: RunFilter; assignee?: AssigneeFilter; q?: string; zoom?: Zoom } = {},
) {
  const query = [
    opts.view && opts.view !== "tree" ? `view=${opts.view}` : undefined,
    opts.epic !== undefined ? `epic=${opts.epic}` : undefined,
    opts.status?.length ? `status=${opts.status.map(encodeURIComponent).join(",")}` : undefined,
    opts.run && opts.run !== "any" ? `run=${opts.run}` : undefined,
    opts.assignee && opts.assignee !== "anyone" ? `assignee=${encodeURIComponent(opts.assignee)}` : undefined,
    opts.q ? `q=${encodeURIComponent(opts.q)}` : undefined,
    opts.view === "timeline" && opts.zoom ? `zoom=${opts.zoom}` : undefined,
  ].filter(Boolean);
  return `/projects/${projectId}/plan${query.length ? `?${query.join("&")}` : ""}`;
}

// A run's, a review's and a Try it page's paths live in core, where the engine writes notification links with them.
export { reviewPath, runPath, tryPath } from "@handoff/core/paths";
