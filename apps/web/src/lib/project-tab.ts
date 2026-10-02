export const PROJECT_TABS = ["runs", "issues", "pulls", "graphs", "settings"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

/** The project page tab from its search params; runs unless another known tab is asked for. */
export function parseProjectTab(params: Record<string, string | string[] | undefined>): ProjectTab {
  const tab = params.tab;
  return typeof tab === "string" && (PROJECT_TABS as readonly string[]).includes(tab) ? (tab as ProjectTab) : "runs";
}

/** The Issues tab filter from ?issues=; to do unless another known filter is asked for. */
export function parseBacklogFilter(params: Record<string, string | string[] | undefined>): "todo" | "started" | "all" {
  const value = params.issues;
  return value === "started" || value === "all" ? value : "todo";
}

/** The views of the Plan page. */
export const PLAN_VIEWS = ["tree", "board"] as const;
export type PlanViewName = (typeof PLAN_VIEWS)[number];

/** The Plan page view from ?view=; the tree unless another known view is asked for. */
export function parsePlanView(params: Record<string, string | string[] | undefined>): PlanViewName {
  const view = params.view;
  return typeof view === "string" && (PLAN_VIEWS as readonly string[]).includes(view) ? (view as PlanViewName) : "tree";
}
