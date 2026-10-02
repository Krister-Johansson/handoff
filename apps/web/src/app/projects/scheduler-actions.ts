"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getProjects } from "@/lib/github";
import { planPath, projectPath } from "@/lib/paths";
import { pauseScheduler, releaseTask, startScheduler, stopScheduler } from "@/server/scheduler";

export type SchedulerActionState = { ok: true } | { ok: false; error: string };

/** Who acts from these pages, as scheduler events record it. */
const ACTOR = "dashboard";

const Project = z.object({ projectId: z.uuid() });
const Settings = Project.extend({
  maxRuns: z.number().int().min(1, "Runs at a time is 1 to 10.").max(10, "Runs at a time is 1 to 10."),
  order: z.enum(["project", "priority"]),
  graph: z.string().min(1, "Pick a graph."),
});

/** Runs one scheduler change; a refusal is a sentence to show as it is. The pages that show the scheduler read it again. */
async function act<T extends z.ZodType>(schema: T, input: unknown, change: (data: z.infer<T>) => Promise<unknown>): Promise<SchedulerActionState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That change cannot be made from here." };
  try {
    await change(parsed.data);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  const { projectId } = parsed.data as { projectId: string };
  revalidatePath(planPath(projectId));
  revalidatePath(projectPath(projectId));
  revalidatePath(projectPath(projectId, "settings"));
  revalidatePath("/settings");
  return { ok: true };
}

const deps = () => ({ db: getDb(), projects: getProjects() });

/** Turn on from the card's form: the settings it shows, and it starts on the next check. */
export async function turnOnSchedulerAction(input: z.input<typeof Settings>): Promise<SchedulerActionState> {
  return act(Settings, input, ({ projectId, maxRuns, order, graph }) => startScheduler(deps(), projectId, { maxRuns, order, graph }, ACTOR));
}

/** Save in Project settings: turns the scheduler on when it is off, and keeps a pause; only Resume resumes. */
export async function saveSchedulerAction(input: z.input<typeof Settings> & { skipLabel: string }): Promise<SchedulerActionState> {
  return act(Settings.extend({ skipLabel: z.string().max(50, "Keep the label under 50 characters.") }), input, ({ projectId, maxRuns, order, graph, skipLabel }) =>
    startScheduler(deps(), projectId, { maxRuns, order, graph, skipLabel: skipLabel.trim() || null }, ACTOR, { resume: false }),
  );
}

export async function pauseSchedulerAction(input: { projectId: string; reason?: string }): Promise<SchedulerActionState> {
  return act(Project.extend({ reason: z.string().max(200, "Keep the reason under 200 characters.").optional() }), input, ({ projectId, reason }) =>
    pauseScheduler(getDb(), projectId, ACTOR, reason?.trim() || undefined),
  );
}

/** Resume keeps the stored settings. */
export async function resumeSchedulerAction(input: { projectId: string }): Promise<SchedulerActionState> {
  return act(Project, input, ({ projectId }) => startScheduler(deps(), projectId, {}, ACTOR));
}

export async function turnOffSchedulerAction(input: { projectId: string }): Promise<SchedulerActionState> {
  return act(Project, input, ({ projectId }) => stopScheduler(getDb(), projectId, ACTOR));
}

/** "Let the scheduler take it" on a task whose run a person cancelled. */
export async function releaseTaskAction(input: { projectId: string; issue: number }): Promise<SchedulerActionState> {
  return act(Project.extend({ issue: z.number().int().positive() }), input, ({ projectId, issue }) => releaseTask(getDb(), projectId, issue, ACTOR));
}
