import Link from "next/link";
import { PencilIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StartRunDialog } from "@/components/projects/forms";
import { RunsTable } from "@/components/projects/runs-table";
import { SectionCard } from "@/components/section-card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { projectPage, repoUrl, sectionCrumbs } from "@/server/project-page";
import { runLines } from "@/server/run-lines";

export const dynamic = "force-dynamic";

const graphPath = (projectId: string, name: string) => `/projects/${projectId}/graphs/${encodeURIComponent(name)}`;

/** The project's runs, under the project header: its repository, default branch and graph, Edit graph and New run. */
export default async function ProjectRunsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, graphs, runs, defaultGraph } = await projectPage(projectId);
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
      <SectionCard>
        {lines ? (
          <RunsTable runs={runs} lines={lines} repoUrl={repoUrl(project)} />
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
