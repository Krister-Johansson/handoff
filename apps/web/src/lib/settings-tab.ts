import type { PlanModeName } from "./project-tab";

type SearchParams = Record<string, string | string[] | undefined>;

/** The library's sections of Settings, one per kind. Subagents has its own tab, since `agents` is Claude Code. */
export const LIBRARY_TABS = ["skills", "subagents", "mcp", "groups"] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

export const SETTINGS_TABS = ["projects", ...LIBRARY_TABS, "appearance", "notifications", "voice", "agents", "assistant", "worker"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Each section's name, as the settings navigation and the breadcrumb show it. */
export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  projects: "Projects",
  skills: "Skills",
  subagents: "Agents",
  mcp: "MCP servers",
  groups: "Groups",
  appearance: "Appearance",
  notifications: "Notifications",
  voice: "Voice",
  agents: "Claude Code",
  assistant: "Assistant",
  worker: "Worker",
};

export const isLibraryTab = (tab: SettingsTab): tab is LibraryTab => (LIBRARY_TABS as readonly string[]).includes(tab);

/** A section of Settings. */
export const settingsPath = (tab: SettingsTab) => `/settings?tab=${tab}`;

/** The settings page tab from its search params; Projects, the first section, unless another known tab is asked for. */
export function parseSettingsTab(params: SearchParams): SettingsTab {
  const tab = params.tab;
  return typeof tab === "string" && (SETTINGS_TABS as readonly string[]).includes(tab) ? (tab as SettingsTab) : "projects";
}

/** The old Library page's ?tab= values and the Settings section each became. */
const OLD_LIBRARY_TABS: Record<string, LibraryTab> = { skills: "skills", agents: "subagents", mcp: "mcp", groups: "groups" };

/** The library section of Settings for a kind of entry, as the entry pages and actions name it. */
export const LIBRARY_TAB_OF = { skill: "skills", agent: "subagents", mcp: "mcp", group: "groups" } as const satisfies Record<string, LibraryTab>;

/**
 * Where an old Library link (/library?tab=...&q=...) goes now: its section of Settings, Skills when it
 * names none, with the search kept.
 */
export function libraryRedirectPath(params: SearchParams): string {
  const tab = (typeof params.tab === "string" && OLD_LIBRARY_TABS[params.tab]) || "skills";
  const q = typeof params.q === "string" && params.q ? `&q=${encodeURIComponent(params.q)}` : "";
  return `${settingsPath(tab)}${q}`;
}

/**
 * The sections of a project's settings. Runs: Graphs, Default library and App launch. Plan: Plan mode (Flow or Timeline),
 * the Scheduler and Estimates (capacity, forecasts and plan budget; the plan budget only in a Flow project).
 * See PROJECT_SETTINGS_GROUPS in components/settings/settings-nav.tsx.
 */
export const PROJECT_SETTINGS_TABS = ["graphs", "library", "launch", "mode", "scheduler", "estimates"] as const;
export type ProjectSettingsTab = (typeof PROJECT_SETTINGS_TABS)[number];

const PROJECT_SETTINGS_TAB_LABEL: Record<ProjectSettingsTab, string> = {
  graphs: "Graphs",
  library: "Default library",
  launch: "App launch",
  mode: "Plan mode",
  scheduler: "Scheduler",
  estimates: "Estimates",
};

/**
 * A project settings section's name, as the side menu and the trail show it. A Flow project has no capacity
 * or forecasts, so its estimates section holds the plan budget only and takes that name.
 */
export const projectSettingsTabLabel = (tab: ProjectSettingsTab, mode: PlanModeName) => (tab === "estimates" && mode === "flow" ? "Plan budget" : PROJECT_SETTINGS_TAB_LABEL[tab]);

/** The project settings tab from its search params; Graphs, the first section, unless another known tab is asked for. */
export function parseProjectSettingsTab(params: SearchParams): ProjectSettingsTab {
  const tab = params.tab;
  return typeof tab === "string" && (PROJECT_SETTINGS_TABS as readonly string[]).includes(tab) ? (tab as ProjectSettingsTab) : "graphs";
}

/** A project's settings, opened on a section when one is given. */
export const projectSettingsPath = (projectId: string, tab?: ProjectSettingsTab) => `/projects/${projectId}/settings${tab ? `?tab=${tab}` : ""}`;
