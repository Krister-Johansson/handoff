import { projectPath } from "../paths";
import { PROJECT_SETTINGS_TABS, projectSettingsPath, projectSettingsTabLabel, settingsPath, SETTINGS_TAB_LABEL, SETTINGS_TABS, type ProjectSettingsTab, type SettingsTab } from "../settings-tab";
import type { SearchProject } from "./types";

/** Which icon a page shows in search, by its route or section; the dialog maps each to a lucide icon. */
export type PageIcon = "home" | "runs" | "plan" | "issues" | "pulls" | "project-settings" | ProjectSettingsTab | "inbox" | "chats" | "settings" | SettingsTab | "project";

/** A place search goes to: its name, where it sits (`trail`), its route and the project it belongs to, null for one of all projects. */
export type SearchPage = { id: string; label: string; trail: string; href: string; icon: PageIcon; projectId: string | null };

/** The group each Settings section sits in, as the settings side menu shows them; Projects and Worker are groups of one. */
const SETTINGS_TRAIL: Record<SettingsTab, string> = {
  projects: "Settings",
  skills: "Settings › Library",
  subagents: "Settings › Library",
  mcp: "Settings › Library",
  groups: "Settings › Library",
  appearance: "Settings › Preferences",
  notifications: "Settings › Preferences",
  voice: "Settings › Preferences",
  agents: "Settings › Integrations",
  assistant: "Settings › Integrations",
  worker: "Settings",
};

/**
 * The pages search offers: the current project's routes and its settings sections, the pages of all
 * projects, Settings and its sections, and every project by name.
 */
export function searchPages(projects: SearchProject[]): SearchPage[] {
  const current = projects.find((p) => p.current);
  const route = (id: string, label: string, href: string, icon: PageIcon, project: SearchProject): SearchPage => ({ id: `page:${id}`, label, trail: project.name, href, icon, projectId: project.id });
  const own: SearchPage[] = current
    ? [
        route("home", "Home", projectPath(current.id), "home", current),
        route("runs", "Runs", projectPath(current.id, "runs"), "runs", current),
        route("plan", "Plan", projectPath(current.id, "plan"), "plan", current),
        route("issues", "Issues", projectPath(current.id, "issues"), "issues", current),
        route("pulls", "Pull requests", projectPath(current.id, "pulls"), "pulls", current),
        route("project-settings", "Project settings", projectSettingsPath(current.id), "project-settings", current),
        ...PROJECT_SETTINGS_TABS.map((tab) => ({
          id: `page:project-settings:${tab}`,
          label: projectSettingsTabLabel(tab, current.planMode),
          trail: `${current.name} › Project settings`,
          href: projectSettingsPath(current.id, tab),
          icon: tab,
          projectId: current.id,
        })),
      ]
    : [];
  const global: SearchPage[] = [
    { id: "page:inbox", label: "Inbox", trail: "All projects", href: "/inbox", icon: "inbox", projectId: null },
    { id: "page:chats", label: "Chats", trail: "All projects", href: "/chats", icon: "chats", projectId: null },
    { id: "page:notifications", label: "Notifications", trail: "All projects", href: "/notifications", icon: "notifications", projectId: null },
    { id: "page:settings", label: "Settings", trail: "All projects", href: "/settings", icon: "settings", projectId: null },
    ...SETTINGS_TABS.map((tab) => ({
      id: `page:settings:${tab}`,
      label: SETTINGS_TAB_LABEL[tab],
      trail: SETTINGS_TRAIL[tab],
      href: settingsPath(tab),
      icon: tab,
      projectId: null,
    })),
  ];
  const named: SearchPage[] = projects.map((p) => ({ id: `project:${p.id}`, label: p.name, trail: `Project · ${p.repo}`, href: projectPath(p.id), icon: "project", projectId: p.id }));
  return [...own, ...global, ...named];
}
