"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { planPath, runPath } from "@/lib/paths";
import { projectSettingsPath } from "@/lib/settings-tab";
import { LibrarySelectionSchema } from "@handoff/core";
import { eq, getLibraryByNames, PIN_REASONS, projects, setProjectLibrary } from "@handoff/db";
import type { IssueSummary } from "@handoff/github";
import { getGitHub, getProjects } from "@/lib/github";
import { addDateFields, addEstimateFields, listGitHubProjects, moveItem, moveToReady, moveToShaping, planIssue, saveArrange, schedule, setSize, setupPlan, type ShapingDeps } from "@/server/shaping";
import { requestMerge, requestMergeAll } from "@handoff/engine/operations";
import { PLAN_MODES, setPlanMode } from "@/server/plan-mode";
import { unpin, writeOrder } from "@/server/flow-order";
import { deleteProject, moveProjectRepo, setCapacity, setPlanBudget, unlinkPlan, updateProject } from "@/server/project-admin";
import { archiveRun, unarchiveRun } from "@/server/pulls";
import { linkDependencies } from "@/server/link-dependencies";
import { listAvailableRepos, type AvailableRepo } from "@/server/repos";
import { createGraphFromTemplate, createProject, deleteGraph, getGraphVersion, renameGraph, runAgain, saveGraphVersion, startRunFromGraph, TEMPLATES, type SaveResult, type TemplateName } from "@/server/graphs";

export type ActionState = { ok?: boolean; error?: string; values?: Record<string, string> };

const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function createProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = { name: field(form, "name"), repo: field(form, "repo"), defaultBranch: field(form, "defaultBranch") || "main" };
  let id: string;
  try {
    id = (await createProject(getDb(), values, getGitHub())).id;
  } catch (error) {
    const message = (error as Error).message;
    const duplicate = message.includes("repo_id") ? "That repository already is a project." : "A project with that name exists.";
    return { ok: false, error: message.includes("duplicate") ? duplicate : message, values };
  }
  // The sidebar in the root layout lists the projects; Settings, Projects shows them too.
  revalidatePath("/", "layout");
  redirect(`/projects/${id}`);
}

export async function listReposAction(): Promise<{ repos: AvailableRepo[] } | { error: string }> {
  const github = getGitHub();
  if (!github) return { error: "GitHub is not configured (GITHUB_TOKEN or a GitHub App in .env), so type the repository instead." };
  try {
    return { repos: await listAvailableRepos(getDb(), github, { maxAgeMs: 60_000 }) };
  } catch (error) {
    return { error: `Could not list repositories from GitHub: ${(error as Error).message}` };
  }
}

export async function updateProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const projectId = field(form, "projectId");
  const values = {
    name: field(form, "name"),
    defaultBranch: field(form, "defaultBranch"),
    setupCommand: field(form, "setupCommand"),
    teardownCommand: field(form, "teardownCommand"),
    agentNotes: field(form, "agentNotes"),
    demoSeedCommand: field(form, "demoSeedCommand"),
    uiPaths: field(form, "uiPaths"),
  };
  try {
    await updateProject(getDb(), projectId, values);
  } catch (error) {
    return { ok: false, error: (error as Error).message, values };
  }
  // The sidebar in the root layout lists the projects; Settings, Projects shows them too.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await deleteProject(getDb(), field(form, "projectId"));
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  // The sidebar in the root layout lists the projects; Settings, Projects shows them too.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Points a project at the place GitHub moved its repository to, from Settings, Projects, Repository moved. */
export async function moveProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const projectId = field(form, "projectId");
  const repo = field(form, "repo");
  try {
    await moveProjectRepo({ db: getDb(), github: getGitHub() }, projectId, repo);
  } catch (error) {
    return { ok: false, error: (error as Error).message, values: { repo } };
  }
  // The sidebar in the root layout names each project's repository; Settings, Projects and the Plan page change too.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createGraphAction(_: ActionState, form: FormData): Promise<ActionState> {
  const projectId = field(form, "projectId");
  const name = field(form, "name");
  const template = field(form, "template") as TemplateName;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return { ok: false, error: "Graph name: lowercase letters, digits and dashes.", values: { name, template } };
  if (!(template in TEMPLATES)) return { ok: false, error: "Pick a template." };
  try {
    await createGraphFromTemplate(getDb(), projectId, name, template);
  } catch {
    return { ok: false, error: "A graph with that name exists.", values: { name, template } };
  }
  redirect(`/projects/${projectId}/graphs/${name}`);
}

export async function saveGraphAction(projectId: string, name: string, document: unknown): Promise<SaveResult> {
  const result = await saveGraphVersion(getDb(), { projectId, name, document });
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function startRunAction(_: ActionState, form: FormData): Promise<ActionState> {
  const projectId = field(form, "projectId");
  const graphName = field(form, "graphName");
  const task = field(form, "task");
  const issues = form.getAll("issue").map(Number).filter(Number.isInteger);
  if (issues.length === 0 && task.length < 5) return { ok: false, error: "Describe the task in a sentence, or link an issue.", values: { task, graphName } };
  let id: string;
  try {
    id = (await startRunFromGraph(getDb(), { projectId, graphName, task, issues, startedBy: "dashboard" }, getGitHub(), getProjects())).id;
  } catch (error) {
    return { ok: false, error: (error as Error).message, values: { task, graphName } };
  }
  redirect(runPath(projectId, id));
}

export async function listIssuesAction(projectId: string): Promise<{ issues: IssueSummary[] } | { error: string }> {
  const github = getGitHub();
  if (!github) return { error: "GitHub is not configured (GITHUB_TOKEN or a GitHub App in .env), so issues cannot be linked." };
  const [project] = await getDb().select().from(projects).where(eq(projects.id, projectId));
  if (!project || project.isDemo) return { error: "This project has no GitHub issues to link." };
  try {
    return { issues: await github.listIssues({ owner: project.repoOwner, name: project.repoName }) };
  } catch (error) {
    return { error: `Could not list issues from GitHub: ${(error as Error).message}` };
  }
}

export async function archivePullAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await archiveRun(getDb(), field(form, "runId"));
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath("/projects/[projectId]", "page");
  return { ok: true };
}

export async function unarchivePullAction(_: ActionState, form: FormData): Promise<ActionState> {
  await unarchiveRun(getDb(), field(form, "runId"));
  revalidatePath("/projects/[projectId]", "page");
  return { ok: true };
}

export async function runAgainAction(_: ActionState, form: FormData): Promise<ActionState> {
  let again: { id: string; projectId: string };
  try {
    const from = field(form, "from");
    again = await runAgain(getDb(), field(form, "runId"), {
      github: getGitHub(),
      projects: getProjects(),
      startedBy: "dashboard",
      from: from === "branch" || from === "scratch" ? from : undefined,
    });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  redirect(runPath(again.projectId, again.id));
}

export async function loadGraphVersionAction(projectId: string, name: string, version: number): Promise<unknown> {
  return (await getGraphVersion(getDb(), projectId, name, version))?.document ?? null;
}

export async function renameGraphAction(_: ActionState, form: FormData): Promise<ActionState> {
  const projectId = field(form, "projectId");
  try {
    await renameGraph(getDb(), projectId, field(form, "from"), field(form, "to"));
  } catch (error) {
    return { ok: false, error: (error as Error).message, values: { to: field(form, "to") } };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function deleteGraphAction(_: ActionState, form: FormData): Promise<ActionState> {
  const projectId = field(form, "projectId");
  try {
    await deleteGraph(getDb(), projectId, field(form, "name"));
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/** Sets the library entries every CLI node in the project's runs gets. Every name must be in the library. */
export async function saveProjectLibraryAction(projectId: string, selection: unknown): Promise<{ ok: true } | { error: string }> {
  const parsed = LibrarySelectionSchema.safeParse(selection);
  if (!parsed.success) return { error: "That is not a library selection." };
  const { missing } = await getLibraryByNames(getDb(), parsed.data);
  if (missing.length) return { error: `Not in the library: ${missing.join(", ")}` };
  if (!(await setProjectLibrary(getDb(), projectId, parsed.data))) return { error: "The project no longer exists." };
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

const MergeRequestSchema = z.object({ runId: z.string().uuid(), projectId: z.string().uuid() });

/** A person asks to merge a run's pull request; it lands when it is first in the project's merge queue. */
export async function requestMergeAction(input: z.input<typeof MergeRequestSchema>): Promise<ActionState> {
  const parsed = MergeRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That pull request cannot be merged from here." };
  try {
    await requestMerge(getDb(), parsed.data.runId);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  revalidatePath("/projects/[projectId]/runs/[runId]", "page");
  return { ok: true };
}

/** A person asks to merge every pull request in the project's queue; they land one at a time, in order. */
export async function requestMergeAllAction(input: { projectId: string }): Promise<ActionState> {
  const parsed = z.object({ projectId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project cannot be merged from here." };
  await requestMergeAll(getDb(), parsed.data.projectId);
  revalidatePath(`/projects/${parsed.data.projectId}`);
  revalidatePath("/projects/[projectId]/runs/[runId]", "page");
  return { ok: true };
}

/** Turns the project's issues' "Depends on" lines into GitHub blocked-by links; a person presses it. */
export async function linkDependenciesAction(input: { projectId: string }): Promise<ActionState & { linked?: number }> {
  const parsed = z.object({ projectId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project cannot be linked from here." };
  const github = getGitHub();
  if (!github) return { ok: false, error: "Set GITHUB_TOKEN or a GitHub App for the dashboard to write to GitHub." };
  const [project] = await getDb().select().from(projects).where(eq(projects.id, parsed.data.projectId));
  if (!project) return { ok: false, error: "No such project." };
  try {
    const added = await linkDependencies(github, { owner: project.repoOwner, name: project.repoName });
    revalidatePath(`/projects/${project.id}`);
    return { ok: true, linked: added.length };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

const PlanTaskSchema = z.object({ projectId: z.string().uuid(), issue: z.number().int().positive() });
const shapingDeps = (): ShapingDeps => ({ db: getDb(), github: getGitHub(), projects: getProjects() });

/** Runs one shaping call from the Plan page; its refusal is a sentence to show as it is, and a refused call changes nothing. */
async function onPlan(projectId: string, write: (deps: ShapingDeps) => Promise<unknown>): Promise<ActionState> {
  try {
    await write(shapingDeps());
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath(planPath(projectId));
  return { ok: true };
}

/** A person moves a shaped task to Ready on the plan, so it joins the backlog. */
export async function moveToReadyAction(input: z.input<typeof PlanTaskSchema>): Promise<ActionState> {
  const parsed = PlanTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That task cannot be moved from here." };
  return onPlan(parsed.data.projectId, (deps) => moveToReady(deps, parsed.data.projectId, [parsed.data.issue]));
}

/** A person moves a Ready task back to Shaping, out of the backlog. */
export async function moveToShapingAction(input: z.input<typeof PlanTaskSchema>): Promise<ActionState> {
  const parsed = PlanTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That task cannot be moved from here." };
  return onPlan(parsed.data.projectId, (deps) => moveToShaping(deps, parsed.data.projectId, [parsed.data.issue]));
}

const PlanIssueSchema = PlanTaskSchema.extend({ story: z.number().int().positive().optional() });

/** A person adds an open issue outside the plan to it as a task in Shaping, under a story when one is picked. */
export async function planIssueAction(input: z.input<typeof PlanIssueSchema>): Promise<ActionState> {
  const parsed = PlanIssueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That issue cannot be planned from here." };
  const { projectId, issue, story } = parsed.data;
  return onPlan(projectId, (deps) => planIssue(deps, projectId, { issue, ...(story !== undefined ? { story } : {}) }));
}

// An emptied number field gives NaN, which setCapacity refuses with the range.
const CapacitySchema = z.object({ projectId: z.string().uuid(), hours: z.union([z.number(), z.nan()]) });

/**
 * Project settings' capacity: the person's hours of work a day on the plan, from 1 to 24. The timeline's
 * bars and Arrange read it, so the plan page is refreshed too.
 */
export async function setCapacityAction(input: z.input<typeof CapacitySchema>): Promise<ActionState> {
  const parsed = CapacitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project's capacity cannot be changed from here." };
  const { projectId, hours } = parsed.data;
  try {
    await setCapacity(getDb(), projectId, hours);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath(projectSettingsPath(projectId));
  revalidatePath(planPath(projectId));
  return { ok: true };
}

const PlanBudgetSchema = z.object({ projectId: z.string().uuid(), files: z.string().max(20), steps: z.string().max(20) });

/** Project settings' plan budget: the most files and steps a plan may have, each as typed; one left empty takes its default. */
export async function setPlanBudgetAction(input: z.input<typeof PlanBudgetSchema>): Promise<ActionState> {
  const parsed = PlanBudgetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project's plan budget cannot be changed from here." };
  const { projectId, files, steps } = parsed.data;
  try {
    await setPlanBudget(getDb(), projectId, { files, steps });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath(projectSettingsPath(projectId));
  return { ok: true };
}

const PlanModeSchema = z.object({ projectId: z.string().uuid(), mode: z.enum(PLAN_MODES) });

/**
 * Project settings' Plan mode: Flow or Timeline. The Plan page shows the view that matches it, so it is
 * refreshed too. Nothing is written to GitHub.
 */
export async function setPlanModeAction(input: z.input<typeof PlanModeSchema>): Promise<ActionState> {
  const parsed = PlanModeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project's plan mode cannot be changed from here." };
  const { projectId, mode } = parsed.data;
  try {
    await setPlanMode(getDb(), projectId, mode);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath(projectSettingsPath(projectId));
  revalidatePath(planPath(projectId));
  return { ok: true };
}

/** A GitHub Project the plan can live in, as the Set up the plan dialog lists it. */
export type GitHubProjectChoice = Awaited<ReturnType<typeof listGitHubProjects>>[number];

/** The person's GitHub Projects for the Set up the plan dialog, those linked to the project's repository first. */
export async function listGitHubProjectsAction(projectId: string): Promise<{ projects: GitHubProjectChoice[] } | { error: string }> {
  if (!z.string().uuid().safeParse(projectId).success) return { error: "That project cannot get a plan from here." };
  try {
    return { projects: await listGitHubProjects(shapingDeps(), projectId) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const SetupPlanSchema = z.object({ projectId: z.string().uuid(), use: z.number().int().positive().optional() });

/** A person sets up the project's plan from the Plan page or Settings, Projects: an existing GitHub Project of theirs (use), or a new one. */
export async function setupPlanAction(input: z.input<typeof SetupPlanSchema>): Promise<ActionState> {
  const parsed = SetupPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project cannot get a plan from here." };
  const { projectId, use } = parsed.data;
  const result = await onPlan(projectId, (deps) => setupPlan(deps, projectId, use !== undefined ? { use } : {}));
  if (result.ok) revalidatePath("/settings");
  return result;
}

/** A person unlinks the plan's GitHub Project in Settings, Projects; the Project stays on GitHub. */
export async function unlinkPlanAction(input: { projectId: string }): Promise<ActionState> {
  const parsed = z.object({ projectId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project cannot be unlinked from here." };
  try {
    await unlinkPlan(getDb(), parsed.data.projectId);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath("/settings");
  revalidatePath(planPath(parsed.data.projectId));
  return { ok: true };
}

const day = z.iso.date().nullable();
const ScheduleSchema = z.object({ projectId: z.string().uuid(), issue: z.number().int().positive(), start: day, target: day });

/** The schedule dialog's save: writes one item's Start and Target to the plan's GitHub Project; null clears a date. */
export async function scheduleAction(input: z.input<typeof ScheduleSchema>): Promise<ActionState> {
  const parsed = ScheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the dates as YYYY-MM-DD, or clear them." };
  const { projectId, issue, start, target } = parsed.data;
  return onPlan(projectId, (deps) => schedule(deps, projectId, [{ issue, start, target }]));
}

const SetSizeSchema = z.object({
  projectId: z.string().uuid(),
  issue: z.number().int().positive(),
  size: z.enum(["S", "M", "L"]).nullable().optional(),
  estimate: z.number().min(0).max(1000).nullable().optional(),
});

/**
 * The size chip's save: a task's Size, its manual estimate in hours (0 or null clears it), or both, written
 * to the plan's GitHub Project with the Target of a dated task moved to match. A person's pick, so no approval card.
 */
export async function setSizeAction(input: z.input<typeof SetSizeSchema>): Promise<ActionState> {
  const parsed = SetSizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give a size of S, M or L, or an estimate from 0 to 1000 hours." };
  const { projectId, issue, size, estimate } = parsed.data;
  return onPlan(projectId, (deps) => setSize(deps, projectId, { issue, ...(size !== undefined ? { size } : {}), ...(estimate !== undefined ? { estimate } : {}) }));
}

const MoveItemSchema = z.object({
  projectId: z.string().uuid(),
  issue: z.number().int().positive(),
  start: day,
  target: day,
  estimate: z.number().min(0).max(1000).nullable().optional(),
});

/**
 * A drop or a keyboard move on the timeline, and its Undo: writes Start and Target, and the manual estimate
 * when the move set or cleared one, in one write. The person's drop is the decision, so there is no approval card.
 */
export async function moveItemAction(input: z.input<typeof MoveItemSchema>): Promise<ActionState> {
  const parsed = MoveItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the dates as YYYY-MM-DD and an estimate from 0 to 1000 hours." };
  const { projectId, issue, start, target, estimate } = parsed.data;
  return onPlan(projectId, (deps) => moveItem(deps, projectId, { issue, start, target, ...(estimate !== undefined ? { estimate } : {}) }));
}

const SaveArrangeSchema = z.object({
  projectId: z.string().uuid(),
  items: z.array(z.object({ issue: z.number().int().positive(), start: z.iso.date(), target: z.iso.date() })).min(1).max(500),
});

/** What Arrange's Save reports: the tasks written, and each task GitHub refused with why. */
export type ArrangeState = { ok: true; saved: number[]; refused: { issue: number; reason: string }[] } | { ok: false; error: string };

/**
 * Arrange by estimate's Save: writes the Start and Target of every task the preview placed, in one batched
 * write. The person confirmed the preview, so there is no approval card.
 */
export async function saveArrangeAction(input: z.input<typeof SaveArrangeSchema>): Promise<ArrangeState> {
  const parsed = SaveArrangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give each task's Start and Target as YYYY-MM-DD." };
  const { projectId, items } = parsed.data;
  try {
    const result = await saveArrange(shapingDeps(), projectId, items);
    revalidatePath(planPath(projectId));
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

const issues = z.array(z.number().int().positive()).max(500);
const WriteOrderSchema = z.object({
  projectId: z.string().uuid(),
  shown: issues,
  queue: issues,
  pin: issues.optional(),
  unpin: issues.optional(),
  reason: z.enum(PIN_REASONS).optional(),
});

/**
 * A drop, a rule-break dialog's choice, Optimize's Apply, and their Undo on the Flow: writes the queue's new
 * order to Project order and pins or unpins tasks as the person's. The person's drop is the decision, so there
 * is no approval card. A refusal is a sentence to show as it is, and a refused write changes no pin.
 */
export async function writeOrderAction(input: z.input<typeof WriteOrderSchema>): Promise<ActionState> {
  const parsed = WriteOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That order cannot be saved from here." };
  const { projectId, ...write } = parsed.data;
  return onPlan(projectId, (deps) => writeOrder(deps, projectId, { ...write, actor: "person" }));
}

/** The pin on a Flow card, or the Pinned tag in its row: the task stops keeping its place. */
export async function unpinAction(input: z.input<typeof PlanTaskSchema>): Promise<ActionState> {
  const parsed = PlanTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That task cannot be unpinned from here." };
  return onPlan(parsed.data.projectId, (deps) => unpin(deps.db, parsed.data.projectId, parsed.data.issue));
}

/** Add the fields, on the timeline's banner and in Settings, Projects: creates Size and Estimate on the plan's GitHub Project, Size only in a Flow project. */
export async function addEstimateFieldsAction(input: { projectId: string }): Promise<ActionState> {
  const parsed = z.object({ projectId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project has no plan to add fields to." };
  const result = await onPlan(parsed.data.projectId, (deps) => addEstimateFields(deps, parsed.data.projectId));
  if (result.ok) revalidatePath("/settings");
  return result;
}

/** Add date fields, on the timeline's banner and in Settings, Projects: creates the Start and Target fields on the plan's GitHub Project. */
export async function addDateFieldsAction(input: { projectId: string }): Promise<ActionState> {
  const parsed = z.object({ projectId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project has no plan to add dates to." };
  const result = await onPlan(parsed.data.projectId, (deps) => addDateFields(deps, parsed.data.projectId));
  if (result.ok) revalidatePath("/settings");
  return result;
}
