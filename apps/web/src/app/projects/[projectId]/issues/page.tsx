import { Backlog, BACKLOG_DESCRIPTION, BACKLOG_TITLE } from "@/components/projects/backlog";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import { parseBacklogFilter } from "@/lib/project-tab";
import { isTodo, listBacklogOnce } from "@/server/backlog";
import { projectPage, repoUrl, sectionCrumbs } from "@/server/project-page";

export const dynamic = "force-dynamic";

/** The repository's open issues, filtered by ?issues=, with Start run for those without a run. */
export default async function ProjectIssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const { project, graphs, defaultGraph } = await projectPage(projectId);
  const filter = parseBacklogFilter(query);
  const backlog = await listBacklogOnce(project.id, getGitHub(), getDb(), getProjects());
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader crumbs={sectionCrumbs(project, "Issues")} title="Issues" />
      {"error" in backlog || !defaultGraph ? (
        <SectionCard title={BACKLOG_TITLE} description={BACKLOG_DESCRIPTION}>
          <Empty className="pt-2 pb-9">
            <EmptyHeader>
              <EmptyTitle>{"error" in backlog ? "No issues to show" : "No graph to run"}</EmptyTitle>
              <EmptyDescription>{"error" in backlog ? backlog.error : "Create a graph under Graphs to start runs."}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SectionCard>
      ) : (
        <Backlog
          projectId={project.id}
          graphs={graphs.map((g) => g.name)}
          graphName={defaultGraph}
          filter={filter}
          counts={backlog.counts}
          issues={filter === "all" ? backlog.issues : backlog.issues.filter((i) => isTodo(i) === (filter === "todo"))}
          repoUrl={repoUrl(project)}
        />
      )}
    </main>
  );
}
