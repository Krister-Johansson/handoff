import { PROJECTS_SETTINGS_PATH } from "./paths";

/** The cookie that keeps the project used last, so the sidebar and / can return to it outside a project. */
export const LAST_PROJECT_COOKIE = "handoff_last_project";

const A_YEAR = 60 * 60 * 24 * 365;

/** The project used last when it still exists, else the first project; undefined without projects. */
export function lastProject<P extends { id: string }>(projects: P[], lastProjectId: string | undefined): P | undefined {
  return projects.find((p) => p.id === lastProjectId) ?? projects[0];
}

/** Where / goes: the project used last, or Settings, Projects to add one when there is none. */
export function homePath(projects: { id: string }[], lastProjectId: string | undefined): string {
  const project = lastProject(projects, lastProjectId);
  return project ? `/projects/${project.id}` : PROJECTS_SETTINGS_PATH;
}

/** Remembers the project in this browser. */
export function rememberProject(projectId: string) {
  document.cookie = `${LAST_PROJECT_COOKIE}=${encodeURIComponent(projectId)}; path=/; max-age=${A_YEAR}; samesite=lax`;
}
