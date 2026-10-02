import { PageHeader } from "@/components/page-header";
import { MergeQueue } from "@/components/pulls/merge-queue";
import { PullRequestList, type PullItem } from "@/components/pulls/pr-list";
import { ArchivePullButton, PullFilters } from "@/components/pulls/pull-filters";
import { SectionCard } from "@/components/section-card";
import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";
import { parsePullFilter } from "@/lib/pull-filter";
import { projectMergeQueue } from "@/server/merge-queue";
import { projectPage, repoUrl, sectionCrumbs } from "@/server/project-page";
import { listProjectPulls } from "@/server/pulls";

export const dynamic = "force-dynamic";

const finished = (pr: PullItem) => !["queued", "running", "waiting"].includes(pr.runStatus);

/** The merge queue and the pull requests the project's runs opened, filtered by ?pr=. */
export default async function ProjectPullsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const { project } = await projectPage(projectId);
  const filter = parsePullFilter(query);
  const [pulls, queue] = await Promise.all([listProjectPulls(getDb(), getGitHub(), project.id, { state: filter }), projectMergeQueue(getDb(), project.id)]);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader crumbs={sectionCrumbs(project, "Pull requests")} title="Pull requests" />
      <MergeQueue projectId={project.id} repoUrl={repoUrl(project)} rows={queue} />
      <SectionCard
        title="Opened by runs"
        description={pulls.live ? "Live state from GitHub for PRs opened by this project's runs." : "Set GITHUB_TOKEN or a GitHub App for the dashboard to show live CI and review state."}
        action={<PullFilters active={filter} counts={pulls.counts} />}
      >
        <PullRequestList
          items={pulls.items}
          emptyText={filter === "archived" ? "Nothing archived." : filter === "all" ? "No pull requests from handoff runs yet." : `No ${filter} pull requests.`}
          actions={(pr) => (finished(pr) ? <ArchivePullButton runId={pr.runId} number={pr.number} archived={pr.archived ?? false} /> : null)}
        />
      </SectionCard>
    </main>
  );
}
