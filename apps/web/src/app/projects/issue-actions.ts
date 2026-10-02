"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Assignee } from "@handoff/github";
import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import type { AssignablePerson } from "@/components/plan/plan-context";
import { issuePath, planPath } from "@/lib/paths";
import { assignableUsers, assignmentOf, setIssueAssignees, type AssignableUser } from "@/server/assignees";
import { startRunFromGraph } from "@/server/graphs";

const IssueSchema = z.object({ projectId: z.string().uuid(), issue: z.number().int().positive() });
const StartSchema = IssueSchema.extend({ graphName: z.string().min(1) });

/**
 * Start run on an issue's page: starts a run of the graph on the issue and stays on the page. `assigned`
 * is the login the start assigned when the issue had no assignee, for the toast to say so.
 */
export async function startIssueRunAction(input: z.input<typeof StartSchema>): Promise<{ ok: true; runId: string; assigned?: string } | { ok: false; error: string }> {
  const parsed = StartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That issue cannot start a run from here." };
  const { projectId, issue, graphName } = parsed.data;
  try {
    const db = getDb();
    const run = await startRunFromGraph(db, { projectId, graphName, task: "", issues: [issue], startedBy: "dashboard" }, getGitHub(), getProjects());
    const assigned = (await assignmentOf(db, run.id)).assigned.find((a) => a.issue === issue)?.login;
    revalidatePath(issuePath(projectId, issue));
    return { ok: true, runId: run.id, ...(assigned ? { assigned } : {}) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** The assignee picker's list: who can be assigned in the project's repository, the token's user first. */
export async function assignableAction(projectId: string): Promise<{ repo: string; users: AssignableUser[] } | { error: string }> {
  if (!z.string().uuid().safeParse(projectId).success) return { error: "That project has no people to assign." };
  try {
    return await assignableUsers(getDb(), getGitHub(), projectId);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * The Plan's assignee control: the people the repository can assign, the token's user first. Bound to
 * the project on the Plan page. Throws when GitHub cannot list them, which the control says.
 */
export async function planPeopleAction(projectId: string): Promise<AssignablePerson[]> {
  if (!z.string().uuid().safeParse(projectId).success) throw new Error("That project has no people to assign.");
  return (await assignableUsers(getDb(), getGitHub(), projectId)).users.map((u) => ({ login: u.login, avatarUrl: u.avatarUrl }));
}

/** The Plan's assignee control: replaces an issue's assignees on GitHub, plus the token's user with `me`. Bound to the project on the Plan page. */
export async function planAssignAction(projectId: string, issue: number, change: { logins: string[]; me?: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await assignAction({ projectId, issue, ...change });
  if (!result.ok) return result;
  revalidatePath(planPath(projectId));
  return { ok: true };
}

const AssignSchema =IssueSchema.extend({ logins: z.array(z.string().min(1)), me: z.boolean().optional() });

/** The assignee picker and Assign me: replaces the issue's assignees on GitHub; the plan's Status stays. */
export async function assignAction(input: z.input<typeof AssignSchema>): Promise<{ ok: true; assignees: Assignee[] } | { ok: false; error: string }> {
  const parsed = AssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That issue cannot be assigned from here." };
  const { projectId, issue, logins, me } = parsed.data;
  try {
    const { assignees } = await setIssueAssignees(getDb(), getGitHub(), projectId, issue, { logins, me });
    revalidatePath(issuePath(projectId, issue));
    return { ok: true, assignees };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
