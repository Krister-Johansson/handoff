import { and, edgeTraversals, eq, events, graphs, graphVersions, inArray, isNull, nodeExecutions, notifications, projects, questions, runs, sql, type Db } from "@handoff/db";
import { planBudgetOf, type PlanBudget } from "@handoff/core";
import type { ProjectsPort } from "@handoff/github";
import { projectsAccessProblem } from "./plan.ts";

const PROJECT_NAME = /^[a-z0-9][a-z0-9-]*$/;
const ACTIVE = ["queued", "running", "waiting"] as const;

type ProjectEdit = {
  name: string;
  defaultBranch: string;
  setupCommand?: string;
  teardownCommand?: string;
  agentNotes?: string;
  demoSeedCommand?: string;
  /** Globs, one a line. */
  uiPaths?: string;
  /** The plan budget's files and steps as typed; empty keeps the default. */
  planBudgetFiles?: string;
  planBudgetSteps?: string;
};

const MAX_BUDGET = 500;

/** A budget number as typed: undefined when empty, refused unless a whole number from 1 to MAX_BUDGET. */
function budgetNumber(value: string | undefined): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BUDGET) throw new Error(`The plan budget's files and steps are each a whole number from 1 to ${MAX_BUDGET}.`);
  return n;
}

/**
 * The plan budget to store: null when both numbers are empty, so the defaults apply; a number left empty
 * takes its default. Undefined leaves the column as it is.
 */
function planBudget(input: ProjectEdit): PlanBudget | null | undefined {
  if (input.planBudgetFiles === undefined && input.planBudgetSteps === undefined) return undefined;
  const files = budgetNumber(input.planBudgetFiles);
  const steps = budgetNumber(input.planBudgetSteps);
  return files === undefined && steps === undefined ? null : planBudgetOf({ ...(files ? { files } : {}), ...(steps ? { steps } : {}) });
}

const MAX_UI_PATHS = 50;

/** Globs one a line, without blank lines; null when there are none, so the defaults apply; undefined leaves the column as it is. */
function globLines(value: string | undefined): string[] | null | undefined {
  if (value === undefined) return undefined;
  const globs = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (globs.length > MAX_UI_PATHS) throw new Error(`List at most ${MAX_UI_PATHS} UI paths.`);
  if (globs.some((g) => g.length > 200)) throw new Error("Keep each UI path under 200 characters.");
  return globs.length ? globs : null;
}

/** A trimmed text, null when empty, refused over `max` characters; undefined leaves the column as it is. */
function optionalText(value: string | undefined, max: number, what: string): string | null | undefined {
  if (value === undefined) return undefined;
  const text = value.trim() || null;
  if (text && text.length > max) throw new Error(`Keep the ${what} under ${max} characters.`);
  return text;
}

/**
 * Renames a project and changes its default branch, setup and teardown commands, agent notes, demo
 * seed command and UI paths. Agent notes are free text every agent step reads, so they must never hold secrets.
 */
export async function updateProject(db: Db, projectId: string, input: ProjectEdit) {
  const name = input.name.trim();
  const defaultBranch = input.defaultBranch.trim();
  if (!PROJECT_NAME.test(name)) throw new Error("Project name: lowercase letters, digits and dashes.");
  if (!defaultBranch) throw new Error("Give the default branch runs start from.");
  const [taken] = await db.select({ id: projects.id }).from(projects).where(eq(projects.name, name));
  if (taken && taken.id !== projectId) throw new Error(`A project named ${name} already exists.`);
  const optional = {
    setupCommand: optionalText(input.setupCommand, 2_000, "setup command"),
    teardownCommand: optionalText(input.teardownCommand, 2_000, "teardown command"),
    agentNotes: optionalText(input.agentNotes, 4_000, "agent notes"),
    demoSeedCommand: optionalText(input.demoSeedCommand, 2_000, "demo seed command"),
    uiPaths: globLines(input.uiPaths),
    planBudget: planBudget(input),
  };
  const changed = Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined));
  await db.update(projects).set({ name, defaultBranch, ...changed, updatedAt: new Date() }).where(eq(projects.id, projectId));
}

/** The GitHub Project that holds a project's plan; title and url are missing when GitHub cannot be read. */
export type PlanLink = { number: number; title?: string; url?: string };

/**
 * Every project as Settings, Projects lists it, by name: repository, default branch, setup and
 * teardown commands, agent notes, demo seed command, UI paths, run count and the plan's GitHub Project. The Project's title and url are read from GitHub; without
 * access, or when GitHub does not answer, the link keeps only its number.
 */
export async function projectsForSettings(db: Db, plan: ProjectsPort | undefined) {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      repoOwner: projects.repoOwner,
      repoName: projects.repoName,
      defaultBranch: projects.defaultBranch,
      setupCommand: projects.setupCommand,
      teardownCommand: projects.teardownCommand,
      agentNotes: projects.agentNotes,
      demoSeedCommand: projects.demoSeedCommand,
      uiPaths: projects.uiPaths,
      planBudget: projects.planBudget,
      isDemo: projects.isDemo,
      planProjectNumber: projects.planProjectNumber,
      runCount: sql<number>`(select count(*)::int from runs r where r.project_id = "projects"."id")`,
    })
    .from(projects)
    .orderBy(projects.name);
  const readable = rows.some((r) => r.planProjectNumber !== null) && plan && !(await projectsAccessProblem(plan)) ? plan : undefined;
  const linkOf = async (owner: string, number: number | null): Promise<PlanLink | null> => {
    if (number === null) return null;
    const found = await readable?.getProject(owner, number).catch(() => undefined);
    return found ? { number, title: found.title, url: found.url } : { number };
  };
  return Promise.all(rows.map(async ({ planProjectNumber, ...row }) => ({ ...row, plan: await linkOf(row.repoOwner, planProjectNumber) })));
}

/** Forgets the GitHub Project that holds a project's plan. The Project, its items and the labels stay on GitHub. */
export async function unlinkPlan(db: Db, projectId: string) {
  const [row] = await db.update(projects).set({ planProjectNumber: null, updatedAt: new Date() }).where(eq(projects.id, projectId)).returning({ id: projects.id });
  if (!row) throw new Error("The project no longer exists.");
}

/**
 * Deletes a project and everything recorded for it: graphs, versions, runs, node executions,
 * questions, edge traversals, events and notifications. Refused while any of its runs is active. The worker's
 * clone and worktrees on disk are left to `handoff gc`.
 */
export async function deleteProject(db: Db, projectId: string) {
  await db.transaction(async (tx) => {
    const projectRuns = await tx.select({ id: runs.id, status: runs.status }).from(runs).where(eq(runs.projectId, projectId));
    const active = projectRuns.filter((r) => (ACTIVE as readonly string[]).includes(r.status)).length;
    if (active > 0) throw new Error(`The project has ${active} active run${active === 1 ? "" : "s"}. Cancel ${active === 1 ? "it" : "them"} first.`);
    const runIds = projectRuns.map((r) => r.id);
    await tx.delete(notifications).where(eq(notifications.projectId, projectId));
    if (runIds.length > 0) {
      await tx.delete(notifications).where(inArray(notifications.runId, runIds));
      await tx.delete(events).where(inArray(events.runId, runIds));
      await tx.delete(questions).where(inArray(questions.runId, runIds));
      await tx.delete(edgeTraversals).where(inArray(edgeTraversals.runId, runIds));
      await tx.delete(nodeExecutions).where(inArray(nodeExecutions.runId, runIds));
      await tx.delete(runs).where(inArray(runs.id, runIds));
    }
    const graphIds = (await tx.select({ id: graphs.id }).from(graphs).where(eq(graphs.projectId, projectId))).map((g) => g.id);
    if (graphIds.length > 0) await tx.delete(graphVersions).where(inArray(graphVersions.graphId, graphIds));
    await tx.delete(graphs).where(eq(graphs.projectId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
  });
}

export type ProjectAttention = {
  /** Open questions from Human gates or Coders on active runs. */
  questions: number;
  /** Failed runs waiting for a repair or a cancel. */
  failed: number;
  /** Pull requests whose checks have finished and that wait for an approving review. */
  reviews: number;
  /** Pull requests waiting for CI. */
  waitingOnCi: number;
  /** Queued or running runs. */
  running: number;
};

const EMPTY: ProjectAttention = { questions: 0, failed: 0, reviews: 0, waitingOnCi: 0, running: 0 };

/** What each project needs from a person, and what it is busy with, keyed by project id. */
export async function projectAttention(db: Db): Promise<Record<string, ProjectAttention>> {
  const latestPrEvent = sql<{ ci?: string } | null>`(
    select e.payload from events e
    where e.node_execution_id = ${nodeExecutions.id} and e.type = 'github.pr'
    order by e.seq desc limit 1
  )`;
  const [open, failed, waitingPrs, busy, all] = await Promise.all([
    db
      .select({ projectId: runs.projectId, n: sql<number>`count(*)::int` })
      .from(questions)
      .innerJoin(runs, eq(runs.id, questions.runId))
      .where(and(isNull(questions.answer), inArray(runs.status, [...ACTIVE])))
      .groupBy(runs.projectId),
    db.select({ projectId: runs.projectId, n: sql<number>`count(*)::int` }).from(runs).where(eq(runs.status, "failed")).groupBy(runs.projectId),
    db
      .select({ projectId: runs.projectId, pr: latestPrEvent })
      .from(nodeExecutions)
      .innerJoin(runs, eq(runs.id, nodeExecutions.runId))
      .where(and(eq(nodeExecutions.status, "waiting"), eq(nodeExecutions.waitKind, "github_pr"))),
    db
      .select({ projectId: runs.projectId, n: sql<number>`count(*)::int` })
      .from(runs)
      .where(inArray(runs.status, ["queued", "running"]))
      .groupBy(runs.projectId),
    db.select({ id: projects.id }).from(projects),
  ]);
  const result: Record<string, ProjectAttention> = Object.fromEntries(all.map((p) => [p.id, { ...EMPTY }]));
  const at = (projectId: string) => (result[projectId] ??= { ...EMPTY });
  for (const row of open) at(row.projectId).questions = row.n;
  for (const row of failed) at(row.projectId).failed = row.n;
  for (const row of busy) at(row.projectId).running = row.n;
  // A PR node only keeps waiting after CI finished when the node requires an approving review.
  for (const row of waitingPrs) {
    if (!row.pr || row.pr.ci === "pending") at(row.projectId).waitingOnCi += 1;
    else at(row.projectId).reviews += 1;
  }
  return result;
}
