"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { planPath, runPath } from "@/lib/paths";
import { LibrarySelectionSchema } from "@handoff/core";
import { eq, getLibraryByNames, projects, setProjectLibrary } from "@handoff/db";
import type { IssueSummary } from "@handoff/github";
import { getGitHub, getProjects } from "@/lib/github";
import { addDateFields, addEstimateFields, listGitHubProjects, moveToReady, moveToShaping, planIssue, schedule, setSize, setupPlan, type ShapingDeps } from "@/server/shaping";
import { requestMerge, requestMergeAll } from "@handoff/engine/operations";
import { deleteProject, unlinkPlan, updateProject } from "@/server/project-admin";
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
    again = await runAgain(getDb(), field(form, "runId"), { projects: getProjects(), startedBy: "dashboard" });
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

/** The timeline banner's Add the fields: creates Size and Estimate on the plan's GitHub Project. */
export async function addEstimateFieldsAction(input: { projectId: string }): Promise<ActionState> {
  const parsed = z.object({ projectId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project has no plan to add fields to." };
  return onPlan(parsed.data.projectId, (deps) => addEstimateFields(deps, parsed.data.projectId));
}

/** The timeline banner's Add date fields: creates the Start and Target fields on the plan's GitHub Project. */
export async function addDateFieldsAction(input: { projectId: string }): Promise<ActionState> {
  const parsed = z.object({ projectId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That project has no plan to add dates to." };
  return onPlan(parsed.data.projectId, (deps) => addDateFields(deps, parsed.data.projectId));
}
