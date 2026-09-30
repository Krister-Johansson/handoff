export const PROJECT_TABS = ["runs", "issues", "pulls", "settings"] as const;
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
