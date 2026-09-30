"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { LibrarySelectionSchema } from "@handoff/core";
import { eq, getLibraryByNames, projects, setProjectLibrary } from "@handoff/db";
import type { IssueSummary } from "@handoff/github";
import { getGitHub } from "@/lib/github";
import { deleteProject, updateProject } from "@/server/project-admin";
import { archiveRun, unarchiveRun } from "@/server/pulls";
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
  revalidatePath("/projects");
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
  const values = { name: field(form, "name"), defaultBranch: field(form, "defaultBranch") };
  try {
    await updateProject(getDb(), projectId, values);
  } catch (error) {
    return { ok: false, error: (error as Error).message, values };
  }
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function deleteProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await deleteProject(getDb(), field(form, "projectId"));
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath("/projects");
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
    id = (await startRunFromGraph(getDb(), { projectId, graphName, task, issues }, getGitHub())).id;
  } catch (error) {
    return { ok: false, error: (error as Error).message, values: { task, graphName } };
  }
  redirect(`/runs/${id}`);
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
  let id: string;
  try {
    id = (await runAgain(getDb(), field(form, "runId"))).id;
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  redirect(`/runs/${id}`);
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
