"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { configurationFromForm, LaunchConfigurationSchema, type LaunchFormField } from "@handoff/core";
import { eq, projects } from "@handoff/db";
import { launchTestOf, startLaunchTest, stopLaunchTest } from "@handoff/engine/launch-test";
import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";
import { projectSettingsPath } from "@/lib/settings-tab";
import { DOCKER_NOT_SUPPORTED } from "@/lib/app-launch";
import { dockerWorkspace, launchTestDeps, saveAppLaunch, testView, type LaunchTestView } from "@/server/app-launch";

/** A refusal: a sentence to show, or what to fix in each field of the form. */
export type AppLaunchRefusal = { ok: false; error?: string; errors?: Partial<Record<LaunchFormField, string>> };

const Form = z.object({
  command: z.string().max(2000),
  cwd: z.string().max(500),
  port: z.string().max(10),
  anyPort: z.boolean(),
  url: z.string().max(2000),
  env: z.array(z.object({ name: z.string().max(200), value: z.string().max(5000) })).max(50),
});
const Project = z.object({ projectId: z.uuid() });
const WithForm = Project.extend({ form: Form });
const NOT_HERE = "That project's App launch cannot be changed from here.";

/** Saves the App launch form as the project's setting. */
export async function saveAppLaunchAction(input: z.input<typeof WithForm>): Promise<{ ok: true } | AppLaunchRefusal> {
  const parsed = WithForm.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_HERE };
  try {
    const result = await saveAppLaunch(getDb(), parsed.data.projectId, parsed.data.form);
    if (!result.ok) return { ok: false, errors: result.errors };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath(projectSettingsPath(parsed.data.projectId));
  return { ok: true };
}

/** The project and the dependencies a Test start needs. */
async function depsFor(projectId: string) {
  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return undefined;
  return { project, deps: launchTestDeps(db, getGitHub(), { owner: project.repoOwner, name: project.repoName }) };
}

/**
 * Test start: the app from a fresh worktree of the default branch, with the form's values, saved or not.
 * Without a form (the repository has a launch file) it uses the saved setting, which the file overrides
 * anyway. Answers at once with the starting Test start; launchTestAction follows it.
 */
export async function startLaunchTestAction(input: z.input<typeof Project> & { form?: z.input<typeof Form> }): Promise<{ ok: true; test: LaunchTestView } | AppLaunchRefusal> {
  const parsed = Project.extend({ form: Form.optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_HERE };
  let launch = null;
  if (parsed.data.form) {
    const result = configurationFromForm(parsed.data.form);
    if (!result.ok) return { ok: false, errors: result.errors };
    launch = result.configuration;
  }
  if (dockerWorkspace()) return { ok: false, error: DOCKER_NOT_SUPPORTED };
  const found = await depsFor(parsed.data.projectId);
  if (!found) return { ok: false, error: NOT_HERE };
  if (!launch) {
    const saved = LaunchConfigurationSchema.safeParse(found.project.launch);
    launch = saved.success ? saved.data : null;
  }
  try {
    const { test, finished } = await startLaunchTest(found.deps, { projectId: found.project.id, launch });
    // The page follows it with launchTestAction; a failure is recorded on the row.
    finished.catch(() => {});
    return { ok: true, test: testView(test, "") };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** The project's latest Test start, for the section to follow while it starts and runs. */
export async function launchTestAction(input: z.input<typeof Project>): Promise<LaunchTestView | null> {
  const parsed = Project.safeParse(input);
  if (!parsed.success) return null;
  const found = await depsFor(parsed.data.projectId);
  if (!found) return null;
  const latest = await launchTestOf(found.deps, found.project.id);
  return latest ? testView(latest.test, latest.log) : null;
}

/** Stops a Test start: the app, then its worktree. */
export async function stopLaunchTestAction(input: z.input<typeof Project> & { id: string }): Promise<LaunchTestView | null> {
  const parsed = Project.extend({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return null;
  const found = await depsFor(parsed.data.projectId);
  if (!found) return null;
  await stopLaunchTest(found.deps, parsed.data.id);
  return launchTestAction({ projectId: parsed.data.projectId });
}
