export const SETTINGS_TABS = ["appearance", "notifications", "agents"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The settings page tab from its search params; appearance unless another known tab is asked for. */
export function parseSettingsTab(params: Record<string, string | string[] | undefined>): SettingsTab {
  const tab = params.tab;
  return typeof tab === "string" && (SETTINGS_TABS as readonly string[]).includes(tab) ? (tab as SettingsTab) : "appearance";
}
