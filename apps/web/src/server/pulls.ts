import { and, desc, eq, isNotNull, isNull, projects, runs, type Db } from "@handoff/db";
import { toFeedback, type GitHubPort } from "@handoff/github";
import type { PullItem } from "@/components/pulls/pr-list";

export type PullFilter = "open" | "merged" | "closed" | "all" | "archived";
export type PullCounts = Record<PullFilter, number>;

const ACTIVE = new Set(["queued", "running", "waiting"]);

/** Which state filter a pull request falls under. Without live state, an active run's PR counts as open. */
function bucket(pr: PullItem): "open" | "merged" | "closed" | undefined {
  if (pr.state === "open" || pr.state === "draft") return "open";
  if (pr.state === "merged" || pr.state === "closed") return pr.state;
  return ACTIVE.has(pr.runStatus) ? "open" : undefined;
}

/**
 * PRs opened by a project's runs, enriched with live state from GitHub when a credential is configured,
 * filtered by state (open by default). Archived runs' PRs appear only under "archived".
 */
export async function listProjectPulls(
  db: Db,
  github: GitHubPort | undefined,
  projectId: string,
  opts: { state?: PullFilter } = {},
): Promise<{ items: PullItem[]; counts: PullCounts; live: boolean }> {
  const rows = await db
    .select({
      runId: runs.id,
      projectId: runs.projectId,
      runStatus: runs.status,
      task: runs.task,
      issues: runs.issues,
      archivedAt: runs.archivedAt,
      prNumber: runs.prNumber,
      branch: runs.branchName,
      owner: projects.repoOwner,
      name: projects.repoName,
      isDemo: projects.isDemo,
    })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(eq(runs.projectId, projectId), isNotNull(runs.prNumber)))
    .orderBy(desc(runs.createdAt))
    .limit(50);
  const all = await Promise.all(
    rows.map(async (row): Promise<PullItem> => {
      const known: PullItem = {
        number: row.prNumber!,
        repo: `${row.owner}/${row.name}`,
        branch: row.branch,
        url: `https://github.com/${row.owner}/${row.name}/pull/${row.prNumber}`,
        runId: row.runId,
        projectId: row.projectId,
        runStatus: row.runStatus,
        task: row.task,
        issues: row.issues,
        archived: row.archivedAt !== null,
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
  const listed = all.filter((pr) => !pr.archived);
  const counts: PullCounts = {
    open: listed.filter((pr) => bucket(pr) === "open").length,
    merged: listed.filter((pr) => bucket(pr) === "merged").length,
    closed: listed.filter((pr) => bucket(pr) === "closed").length,
    all: listed.length,
    archived: all.length - listed.length,
  };
  const state = opts.state ?? "open";
  const items = state === "archived" ? all.filter((pr) => pr.archived) : state === "all" ? listed : listed.filter((pr) => bucket(pr) === state);
  return { items, counts, live: github !== undefined };
}

/** Hides a finished run's pull request from the dashboard's lists. */
export async function archiveRun(db: Db, runId: string) {
  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error("run not found");
  if (ACTIVE.has(run.status)) throw new Error(`The run is still ${run.status}; archive it when it has finished.`);
  await db.update(runs).set({ archivedAt: new Date() }).where(and(eq(runs.id, runId), isNull(runs.archivedAt)));
}

export async function unarchiveRun(db: Db, runId: string) {
  await db.update(runs).set({ archivedAt: null }).where(eq(runs.id, runId));
}
