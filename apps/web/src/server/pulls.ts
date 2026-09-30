import { and, desc, eq, isNotNull, projects, runs, type Db } from "@handoff/db";
import { toFeedback, type GitHubPort } from "@handoff/github";
import type { PullItem } from "@/components/pulls/pr-list";

/** PRs opened by a project's runs, enriched with live state from GitHub when a credential is configured. */
export async function listProjectPulls(db: Db, github: GitHubPort | undefined, projectId: string): Promise<{ items: PullItem[]; live: boolean }> {
  const rows = await db
    .select({ runId: runs.id, runStatus: runs.status, task: runs.task, issues: runs.issues, prNumber: runs.prNumber, branch: runs.branchName, owner: projects.repoOwner, name: projects.repoName, isDemo: projects.isDemo })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(eq(runs.projectId, projectId), isNotNull(runs.prNumber)))
    .orderBy(desc(runs.createdAt))
    .limit(20);
  const items = await Promise.all(
    rows.map(async (row): Promise<PullItem> => {
      const known: PullItem = {
        number: row.prNumber!,
        repo: `${row.owner}/${row.name}`,
        branch: row.branch,
        url: `https://github.com/${row.owner}/${row.name}/pull/${row.prNumber}`,
        runId: row.runId,
        runStatus: row.runStatus,
        task: row.task,
        issues: row.issues,
        state: "unknown",
        ci: "unknown",
        review: "unknown",
      };
      if (!github || row.isDemo) return known;
      try {
        const snap = await github.getPrSnapshot({ owner: row.owner, name: row.name }, row.prNumber!);
        const feedback = toFeedback(snap, []);
        return {
          ...known,
          title: snap.title,
          url: snap.url,
          state: snap.state === "open" && snap.draft ? "draft" : snap.state,
          ci: snap.checks === null && snap.state !== "open" ? "unknown" : feedback.ci.status,
          review: feedback.review.decision === "commented" ? "none" : feedback.review.decision,
          additions: snap.additions,
          deletions: snap.deletions,
        };
      } catch {
        return known;
      }
    }),
  );
  return { items, live: github !== undefined };
}
