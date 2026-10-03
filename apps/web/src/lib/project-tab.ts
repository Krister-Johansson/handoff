import { ZOOMS, type Zoom } from "./plan/timeline-scale";

/** A project's pages under /projects/<id>, in the order the sidebar lists them. Its graphs are a section of its settings. */
export const PROJECT_SECTIONS = ["runs", "plan", "issues", "pulls", "settings"] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

/** The tabs of the project page before each became its own route; old links still carry them as ?tab=. */
const OLD_TABS: readonly string[] = ["runs", "issues", "pulls", "graphs", "settings"];

/**
 * Where an old project link (/projects/<id>?tab=...) goes now: the tab's route with the other
 * search params kept, or Runs when it names no tab. Graphs is a section of project settings.
 */
export function oldTabPath(projectId: string, params: Record<string, string | string[] | undefined>): string {
  const tab = typeof params.tab === "string" && OLD_TABS.includes(params.tab) ? params.tab : "runs";
  if (tab === "graphs") return `/projects/${projectId}/settings?tab=graphs`;
  const rest = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) rest.append(key, v);
  }
  const query = rest.toString();
  return `/projects/${projectId}/${tab}${query ? `?${query}` : ""}`;
}

/** The Issues tab filter from ?issues=; to do unless another known filter is asked for. */
export function parseBacklogFilter(params: Record<string, string | string[] | undefined>): "todo" | "started" | "all" {
  const value = params.issues;
  return value === "started" || value === "all" ? value : "todo";
}

/** The views of the Plan page: the third is Timeline or Flow, following the project's plan mode. */
export const PLAN_VIEWS = ["tree", "board", "timeline", "flow"] as const;
export type PlanViewName = (typeof PLAN_VIEWS)[number];

/** How a project plans its work; the client keeps its own copy so the database package stays on the server. */
export type PlanModeName = "flow" | "timeline";

/** The timeline's zoom from ?zoom=; undefined lets the timeline pick one from its range. */
export function parseZoom(params: Record<string, string | string[] | undefined>): Zoom | undefined {
  const zoom = params.zoom;
  return typeof zoom === "string" && (ZOOMS as readonly string[]).includes(zoom) ? (zoom as Zoom) : undefined;
}

/**
 * The Plan page view from ?view=: the plan mode's own view (Flow or Timeline) unless the tree or the board
 * is asked for. Timeline and Flow both open the plan mode's view, so an old link opens Flow in a Flow
 * project and Timeline in a Timeline one.
 */
export function parsePlanView(params: Record<string, string | string[] | undefined>, mode: PlanModeName): PlanViewName {
  const view = params.view;
  return view === "tree" || view === "board" ? view : mode;
}
