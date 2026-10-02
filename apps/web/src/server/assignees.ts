import { and, asc, eq, events, inArray, projects, type Db, type DbExecutor } from "@handoff/db";
import type { Assignable, Assignee, GitHubPort, RepoRef } from "@handoff/github";
import { assignSkipReason } from "../lib/event-summary";

/** What starting a run did to its issues' assignees: who it assigned, and why it assigned nobody to the others. */
export type RunAssignment = { assigned: { issue: number; login: string }[]; notAssigned: { issue: number; reason: string }[] };

/** The assignment a run's start recorded, from its issue.assigned and issue.assign.skipped events. */
export async function assignmentOf(db: DbExecutor, runId: string): Promise<RunAssignment> {
  const rows = await db
    .select({ type: events.type, payload: events.payload })
    .from(events)
    .where(and(eq(events.runId, runId), inArray(events.type, ["issue.assigned", "issue.assign.skipped"])))
    .orderBy(asc(events.seq));
  const assignment: RunAssignment = { assigned: [], notAssigned: [] };
  for (const { type, payload } of rows) {
    const p = payload as { issue: number; login?: string; reason?: string };
    if (type === "issue.assigned") assignment.assigned.push({ issue: p.issue, login: String(p.login) });
    else assignment.notAssigned.push({ issue: p.issue, reason: assignSkipReason(String(p.reason)) });
  }
  return assignment;
}

/** The token's user, "me" on the dashboard; undefined with a GitHub App, without GitHub, or when GitHub does not answer. */
export async function tokenUser(github: GitHubPort | undefined): Promise<string | undefined> {
  return github?.viewer().catch(() => undefined);
}

/** A person the assignee picker offers; `you` marks the token's user. */
export type AssignableUser = Assignable & { you: boolean };

/** The people who can be assigned issues in the project's repository, the token's user first. */
export async function assignableUsers(db: Db, github: GitHubPort | undefined, projectId: string): Promise<{ repo: string; users: AssignableUser[] }> {
  const { repo, gh } = await access(db, github, projectId);
  const [users, viewer] = await Promise.all([gh.listAssignable(repo), gh.viewer().catch(() => undefined)]);
  const marked = users.map((u) => ({ ...u, you: u.login === viewer }));
  return { repo: `${repo.owner}/${repo.name}`, users: [...marked.filter((u) => u.you), ...marked.filter((u) => !u.you)] };
}

/** The project's repository, refusing a demo project and a dashboard without GitHub access. */
async function access(db: Db, github: GitHubPort | undefined, projectId: string): Promise<{ repo: RepoRef; gh: GitHubPort }> {
  const [project] = await db.select({ repoOwner: projects.repoOwner, repoName: projects.repoName, isDemo: projects.isDemo }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found.");
  if (project.isDemo) throw new Error("The demo project has no GitHub issues.");
  if (!github) throw new Error("Assigning needs GitHub access (GITHUB_TOKEN or a GitHub App).");
  return { repo: { owner: project.repoOwner, name: project.repoName }, gh: github };
}

const NO_USER ="handoff uses a GitHub App, which acts as no person, so it cannot tell who you are. Set GITHUB_TOKEN to a person's token to assign yourself.";

/**
 * Replaces an issue's assignees on GitHub with `logins`, plus the token's user with `me`. Refuses a login
 * the repository cannot assign, and changes nothing then. The plan's Status stays as it is; handoff stores nothing.
 */
export async function setIssueAssignees(
  db: Db,
  github: GitHubPort | undefined,
  projectId: string,
  issue: number,
  input: { logins: string[]; me?: boolean | undefined },
): Promise<{ issue: number; assignees: Assignee[] }> {
  const { repo, gh } = await access(db, github, projectId);
  const me = input.me ? await gh.viewer() : undefined;
  if (input.me && !me) throw new Error(NO_USER);
  const logins = [...new Set([...input.logins, ...(me ? [me] : [])])];
  if (logins.length > 0) {
    const assignable = new Set((await gh.listAssignable(repo)).map((a) => a.login.toLowerCase()));
    const refused = logins.filter((login) => !assignable.has(login.toLowerCase()));
    if (refused.length) throw new Error(`${refused.join(", ")} cannot be assigned in ${repo.owner}/${repo.name}.`);
  }
  return { issue, assignees: await gh.setAssignees(repo, issue, logins) };
}
