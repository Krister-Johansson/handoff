import Link from "next/link";
import { PencilIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StartRunDialog } from "@/components/projects/forms";
import { RunFilters } from "@/components/projects/run-filters";
import { RunsTable } from "@/components/projects/runs-table";
import { SectionCard } from "@/components/section-card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { graphPath } from "@/lib/paths";
import { parseRunsFilter, RUNS_FILTERS } from "@/lib/run-status-filter";
import { projectPage, repoUrl, sectionCrumbs } from "@/server/project-page";
import { projectRuns } from "@/server/project-runs";
import { runLines } from "@/server/run-lines";

export const dynamic = "force-dynamic";

/**
 * The project's runs, under the project header: its repository, default branch and graph, Edit graph and
 * New run. ?status= narrows them to Active, Waiting, Failed or Done.
 */
export default async function ProjectRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const { project, graphs, defaultGraph } = await projectPage(projectId);
  const filter = parseRunsFilter(query);
  const { runs, counts } = await projectRuns(getDb(), project.id, filter);
  const graph = graphs.find((g) => g.name === defaultGraph);
  const lines = runs.length
    ? await runLines(
        getDb(),
        runs.map((r) => r.id),
      )
    : undefined;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={sectionCrumbs(project, "Runs")}
        title="Runs"
        description={
          <>
            <a className="font-mono text-xs hover:underline hover:underline-offset-3" href={repoUrl(project)}>
              {project.repoOwner}/{project.repoName}
            </a>
            <span className="text-muted-foreground/60"> · </span>
            default branch <span className="font-mono text-xs">{project.defaultBranch}</span>
            {graph && (
              <>
                <span className="text-muted-foreground/60"> · </span>
                graph <span className="font-mono text-xs">{graph.name}</span> v{graph.latestVersion}
              </>
            )}
          </>
        }
        actions={
          <>
            {graph && (
              <Button variant="outline" asChild>
                <Link href={graphPath(project.id, graph.name)}>
                  <PencilIcon data-icon="inline-start" />
                  Edit graph
                </Link>
              </Button>
            )}
            {!project.isDemo && defaultGraph && <StartRunDialog projectId={project.id} graphs={graphs.map((g) => g.name)} graphName={defaultGraph} label="New run" size="default" />}
          </>
        }
      />
      <SectionCard action={counts.all > 0 ? <RunFilters projectId={project.id} active={filter} counts={counts} /> : undefined}>
        {lines ? (
          <RunsTable runs={runs} lines={lines} repoUrl={repoUrl(project)} />
        ) : counts.all > 0 ? (
          <Empty className="py-9">
            <EmptyHeader>
              <EmptyTitle>No {RUNS_FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} runs</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <Empty className="py-9">
            <EmptyHeader>
              <EmptyTitle>No runs yet</EmptyTitle>
              <EmptyDescription>Start one with New run.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </SectionCard>
    </main>
  );
}
