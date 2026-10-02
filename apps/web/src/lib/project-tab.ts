import { ZOOMS, type Zoom } from "./plan/timeline-scale";

/** A project's pages under /projects/<id>, in the order the sidebar lists them. */
export const PROJECT_SECTIONS = ["runs", "plan", "issues", "pulls", "graphs", "settings"] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

/** The tabs of the project page before each became its own route; old links still carry them as ?tab=. */
const OLD_TABS: readonly string[] = ["runs", "issues", "pulls", "graphs", "settings"];

/**
 * Where an old project link (/projects/<id>?tab=...) goes now: the tab's route with the other
 * search params kept, or Runs when it names no tab.
 */
export function oldTabPath(projectId: string, params: Record<string, string | string[] | undefined>): string {
  const tab = typeof params.tab === "string" && OLD_TABS.includes(params.tab) ? params.tab : "runs";
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

/** The views of the Plan page. */
export const PLAN_VIEWS = ["tree", "board", "timeline"] as const;
export type PlanViewName = (typeof PLAN_VIEWS)[number];

/** The timeline's zoom from ?zoom=; undefined lets the timeline pick one from its range. */
export function parseZoom(params: Record<string, string | string[] | undefined>): Zoom | undefined {
  const zoom = params.zoom;
  return typeof zoom === "string" && (ZOOMS as readonly string[]).includes(zoom) ? (zoom as Zoom) : undefined;
}

/** The Plan page view from ?view=; the tree unless another known view is asked for. */
export function parsePlanView(params: Record<string, string | string[] | undefined>): PlanViewName {
  const view = params.view;
  return typeof view === "string" && (PLAN_VIEWS as readonly string[]).includes(view) ? (view as PlanViewName) : "tree";
}
