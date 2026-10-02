import { and, eq, graphs, projects, projectSchedulers, schedulerEvents, sql, type Db, type DbExecutor, type ProjectSchedulerRow } from "@handoff/db";
import { nudgeScheduler } from "@handoff/engine/backlog-scheduler";
import type { ProjectsPort } from "@handoff/github";
import { getProjectDetail } from "./graphs";
import { projectsAccessProblem } from "./plan";

export type SchedulerDeps = { db: Db; projects: ProjectsPort | undefined };

/** The settings start_scheduler may change; each left out keeps its stored value, or its default when first turned on. */
export type SchedulerSettings = { maxRuns?: number | undefined; order?: "project" | "priority" | undefined; graph?: string | undefined };

type Stored = Pick<ProjectSchedulerRow, "maxRuns" | "order" | "graphName" | "skipLabel">;

/** The settings as scheduler events and run.scheduled record them. */
const settingsOf = (row: Stored) => ({ maxRuns: row.maxRuns, order: row.order, graphName: row.graphName, skipLabel: row.skipLabel });
const same = (a: Stored, b: Stored) => JSON.stringify(settingsOf(a)) === JSON.stringify(settingsOf(b));

async function projectOf(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error(`There is no project ${projectId}.`);
  return project;
}

async function record(db: DbExecutor, projectId: string, type: string, payload: Record<string, unknown>) {
  await db.insert(schedulerEvents).values({ projectId, type, payload });
}

/**
 * Turns the project's scheduler on, or resumes it, with the settings given; the others keep their
 * stored values. Records scheduler.started the first time and after it was off, scheduler.resumed
 * after a pause and scheduler.changed when the settings change, and brings the next check forward.
 * Refuses a project without a plan and a graph the project does not have.
 */
export async function startScheduler(deps: SchedulerDeps, projectId: string, settings: SchedulerSettings, actor: string) {
  const { db } = deps;
  const project = await projectOf(db, projectId);
  if (project.isDemo) throw new Error(`${project.name} is a demo project: its runs are simulated, so the scheduler cannot start any.`);
  if (project.planProjectNumber === null) {
    throw new Error(`${project.name} has no plan: the scheduler starts runs on the plan's Ready tasks. Link a GitHub Project to it with setup_plan first.`);
  }
  const access = await projectsAccessProblem(deps.projects);
  if (access) throw new Error(`The scheduler reads Ready tasks from GitHub Projects. ${access}`);
  const [stored] = await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId));
  const graphName = settings.graph ?? stored?.graphName ?? (await getProjectDetail(db, projectId))?.defaultGraph;
  if (!graphName) throw new Error(`${project.name} has no graph yet. Create one on its Graphs page.`);
  const [graph] = await db.select({ id: graphs.id }).from(graphs).where(and(eq(graphs.projectId, projectId), eq(graphs.name, graphName)));
  if (!graph) throw new Error(`${project.name} has no graph ${graphName}.`);
  if (settings.order === "priority") {
    // The check reads the Project the way tick.ts does: the repository owner's Project by number.
    const plan = await deps.projects?.getProject(project.repoOwner, project.planProjectNumber);
    if (plan?.priorityOptions === undefined) {
      throw new Error(`GitHub Project #${project.planProjectNumber} has no Priority field, so the scheduler cannot order tasks by priority. Add a single select field named Priority to the Project, or use Project order.`);
    }
  }
  const next: Stored = { maxRuns: settings.maxRuns ?? stored?.maxRuns ?? 1, order: settings.order ?? stored?.order ?? "project", graphName, skipLabel: stored?.skipLabel ?? "human" };

  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)).for("update");
    const on = { enabled: true, maxRuns: next.maxRuns, order: next.order, graphName: next.graphName, pausedAt: null, pausedBy: null, pauseReason: null, startFailures: 0 };
    await tx.insert(projectSchedulers).values({ projectId, ...on }).onConflictDoUpdate({ target: projectSchedulers.projectId, set: on });
    if (!before?.enabled) await record(tx, projectId, "scheduler.started", { by: actor, settings: settingsOf(next) });
    else {
      if (before.pausedAt) await record(tx, projectId, "scheduler.resumed", { by: actor });
      if (!same(before, next)) await record(tx, projectId, "scheduler.changed", { by: actor, from: settingsOf(before), to: settingsOf(next) });
    }
    // Turned on, resumed or changed: the next check comes now, or 10 seconds after the last.
    await nudgeScheduler(tx, projectId);
  });
  return { state: "on" as const, max_runs: next.maxRuns, order: next.order, graph: next.graphName };
}

/**
 * Pauses the project's scheduler: no new starts until start_scheduler resumes it. Active runs go on.
 * Pausing a paused scheduler changes nothing, and a scheduler that is off stays off.
 */
export async function pauseScheduler(db: Db, projectId: string, actor: string, reason?: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)).for("update");
    if (!row?.enabled) return { state: "off" as const };
    if (row.pausedAt) return { state: "paused" as const, reason: row.pauseReason };
    await tx
      .update(projectSchedulers)
      .set({ pausedAt: sql`now()`, pausedBy: "person", pauseReason: reason ?? null })
      .where(eq(projectSchedulers.projectId, projectId));
    await record(tx, projectId, "scheduler.paused", { by: actor, ...(reason ? { reason } : {}) });
    return { state: "paused" as const, reason: reason ?? null };
  });
}
