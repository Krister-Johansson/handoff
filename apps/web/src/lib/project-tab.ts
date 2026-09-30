export const PROJECT_TABS = ["runs", "pulls", "settings"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

/** The project page tab from its search params; runs unless another known tab is asked for. */
export function parseProjectTab(params: Record<string, string | string[] | undefined>): ProjectTab {
  const tab = params.tab;
  return typeof tab === "string" && (PROJECT_TABS as readonly string[]).includes(tab) ? (tab as ProjectTab) : "runs";
}
