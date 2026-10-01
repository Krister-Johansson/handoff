import { cache } from "react";
import { desc, eq, projects, runs, type Db } from "@handoff/db";
import type { GitHubPort, IssueSummary } from "@handoff/github";

export type BacklogRun = { id: string; status: string; prNumber: number | null };
export type BacklogIssue = IssueSummary & { run: BacklogRun | null };
export type BacklogFilter = "todo" | "started" | "all";
export type BacklogCounts = Record<BacklogFilter, number>;

/** An issue is to do until a run works on it; a cancelled run gives it back. */
export const isTodo = (issue: BacklogIssue) => issue.run === null || issue.run.status === "cancelled";

/**
 * The repository's open issues, newest activity first, each with the latest run that links it. This
 * is the project's backlog: write issues on GitHub (by hand or with Claude Code), start runs here.
 */
/** The backlog once per request, for the Issues tab and the count on its tab. */
export const listBacklogOnce = cache((projectId: string, github: GitHubPort | undefined, db: Db) => listBacklog(db, github, projectId));

export async function listBacklog(
  db: Db,
  github: GitHubPort | undefined,
  projectId: string,
): Promise<{ issues: BacklogIssue[]; counts: BacklogCounts } | { error: string }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { error: "Project not found." };
  if (project.isDemo) return { error: "The demo project has no GitHub issues." };
  if (!github) return { error: "Set GITHUB_TOKEN or a GitHub App for the dashboard to list the repository's issues." };
  const [open, projectRuns] = await Promise.all([
    github.listIssues({ owner: project.repoOwner, name: project.repoName }),
    db
      .select({ id: runs.id, status: runs.status, prNumber: runs.prNumber, issues: runs.issues })
      .from(runs)
      .where(eq(runs.projectId, projectId))
      .orderBy(desc(runs.createdAt)),
  ]);
  const latest = new Map<number, BacklogRun>();
  for (const run of projectRuns) {
    for (const issue of run.issues) if (!latest.has(issue.number)) latest.set(issue.number, { id: run.id, status: run.status, prNumber: run.prNumber });
  }
  // Issues that can start come first; blocked ones follow. Each part keeps GitHub's order (most recently updated first).
  const startable = (i: IssueSummary) => i.blockedBy.length === 0;
  const issues = [...open.filter(startable), ...open.filter((i) => !startable(i))].map((issue) => ({ ...issue, run: latest.get(issue.number) ?? null }));
  const todo = issues.filter(isTodo).length;
  return { issues, counts: { todo, started: issues.length - todo, all: issues.length } };
}
