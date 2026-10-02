import { eq, projects, type Db } from "@handoff/db";
import type { ProjectsPort } from "@handoff/github";

export type SchedulerDeps = { db: Db; projects: ProjectsPort | undefined };

/** The settings start_scheduler may change; each left out keeps its stored value, or its default when first turned on. */
export type SchedulerSettings = { maxRuns?: number | undefined; order?: "project" | "priority" | undefined; graph?: string | undefined };

async function projectOf(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error(`There is no project ${projectId}.`);
  return project;
}

/**
 * Turns the project's scheduler on, or resumes it, with the settings given. Refuses a project
 * without a plan.
 */
export async function startScheduler(deps: SchedulerDeps, projectId: string, _settings: SchedulerSettings, _actor: string) {
  const project = await projectOf(deps.db, projectId);
  if (project.planProjectNumber === null) {
    throw new Error(`${project.name} has no plan: the scheduler starts runs on the plan's Ready tasks. Link a GitHub Project to it with setup_plan first.`);
  }
  throw new Error("not yet");
}
