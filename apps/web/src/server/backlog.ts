import { cache } from "react";
import { desc, eq, projects, runs, type Db } from "@handoff/db";
import type { GitHubPort, IssueSummary, PlanKind, PlanStatus, ProjectsPort } from "@handoff/github";

export type BacklogRun = { id: string; status: string; prNumber: number | null };
/** Where an issue stands in the project's plan; null when the project has no plan. */
export type BacklogPlan = { kind: PlanKind | undefined; status: PlanStatus | undefined; planned: boolean } | null;
export type BacklogIssue = IssueSummary & { run: BacklogRun | null; plan: BacklogPlan };
export type BacklogFilter = "todo" | "started" | "all";
export type BacklogCounts = Record<BacklogFilter, number>;

/** An issue is to do until a run works on it; a cancelled run gives it back. */
export const isTodo = (issue: { run: BacklogRun | null }) => issue.run === null || issue.run.status === "cancelled";

/** The latest run that links each issue of a project, by issue number. */
export async function latestRuns(db: Db, projectId: string): Promise<Map<number, BacklogRun>> {
  const projectRuns = await db
    .select({ id: runs.id, status: runs.status, prNumber: runs.prNumber, issues: runs.issues })
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .orderBy(desc(runs.createdAt));
  const latest = new Map<number, BacklogRun>();
  for (const run of projectRuns) {
    for (const issue of run.issues) if (!latest.has(issue.number)) latest.set(issue.number, { id: run.id, status: run.status, prNumber: run.prNumber });
  }
  return latest;
}

/** The backlog once per request, for the Issues tab and the count on its tab. */
export const listBacklogOnce = cache((projectId: string, github: GitHubPort | undefined, db: Db, plan?: ProjectsPort) => listBacklog(db, github, projectId, plan));

/**
 * The repository's open issues, newest activity first, each with the latest run that links it. This
 * is the project's backlog: write issues on GitHub (by hand or with Claude Code), start runs here.
 * With a plan on a GitHub Project, Ready is the gate: of the issues in the Project only the tasks in
 * Ready that no run works on are listed, next to the unplanned issues outside the Project.
 */
export async function listBacklog(
  db: Db,
  github: GitHubPort | undefined,
  projectId: string,
  plan?: ProjectsPort,
): Promise<{ issues: BacklogIssue[]; counts: BacklogCounts } | { error: string }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { error: "Project not found." };
  if (project.isDemo) return { error: "The demo project has no GitHub issues." };
  if (!github) return { error: "Set GITHUB_TOKEN or a GitHub App for the dashboard to list the repository's issues." };
  const repo = { owner: project.repoOwner, name: project.repoName };
  const number = project.planProjectNumber;
  const [open, latest, items] = await Promise.all([
    github.listIssues(repo),
    latestRuns(db, projectId),
    plan && number !== null ? plan.listItems(repo.owner, number, repo) : undefined,
  ]);
  const inPlan = new Map(items?.map((item) => [item.number, item]));
  const all = open.map((issue): BacklogIssue => {
    const item = inPlan.get(issue.number);
    return { ...issue, run: latest.get(issue.number) ?? null, plan: items ? { kind: item?.kind, status: item?.status, planned: item !== undefined } : null };
  });
  const gated = all.filter((issue) => !issue.plan?.planned || (issue.plan.kind === "task" && issue.plan.status === "Ready" && isTodo(issue)));
  // Issues that can start come first; blocked ones follow. Each part keeps GitHub's order (most recently updated first).
  const startable = (i: IssueSummary) => i.blockedBy.length === 0;
  const issues = [...gated.filter(startable), ...gated.filter((i) => !startable(i))];
  const todo = issues.filter(isTodo).length;
  return { issues, counts: { todo, started: issues.length - todo, all: issues.length } };
}
