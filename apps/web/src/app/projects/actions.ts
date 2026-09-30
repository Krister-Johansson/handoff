"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";
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
    return { ok: false, error: message.includes("duplicate") ? "A project with that name exists." : message, values };
  }
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
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
  if (task.length < 5) return { ok: false, error: "Describe the task in a sentence.", values: { task } };
  const run = await startRunFromGraph(getDb(), { projectId, graphName, task });
  redirect(`/runs/${run.id}`);
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
