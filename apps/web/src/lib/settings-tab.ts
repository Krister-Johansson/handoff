export const SETTINGS_TABS = ["projects", "appearance", "notifications", "voice", "agents", "assistant", "worker"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Each section's name, as the settings navigation and the breadcrumb show it. */
export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  projects: "Projects",
  appearance: "Appearance",
  notifications: "Notifications",
  voice: "Voice",
  agents: "Claude Code",
  assistant: "Assistant",
  worker: "Worker",
};

/** The settings page tab from its search params; Projects, the first section, unless another known tab is asked for. */
export function parseSettingsTab(params: Record<string, string | string[] | undefined>): SettingsTab {
  const tab = params.tab;
  return typeof tab === "string" && (SETTINGS_TABS as readonly string[]).includes(tab) ? (tab as SettingsTab) : "projects";
}
