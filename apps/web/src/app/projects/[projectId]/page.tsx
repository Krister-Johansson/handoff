import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { projectCrumbs } from "@/server/crumbs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { NewGraphDialog, StartRunDialog } from "@/components/projects/forms";
import { Backlog, BACKLOG_DESCRIPTION, BACKLOG_TITLE } from "@/components/projects/backlog";
import { ProjectSettingsActions } from "@/components/projects/project-card";
import { GraphList } from "@/components/projects/graph-list";
import { Count, ProjectTabs } from "@/components/projects/project-tabs";
import { RunsTable } from "@/components/projects/runs-table";
import { CARD_BODY, SectionCard } from "@/components/section-card";
import { PullRequestList, type PullItem } from "@/components/pulls/pr-list";
import { MergeQueue } from "@/components/pulls/merge-queue";
import { ArchivePullButton, PullFilters } from "@/components/pulls/pull-filters";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import { parseBacklogFilter, parseProjectTab } from "@/lib/project-tab";
import { parsePullFilter } from "@/lib/pull-filter";
import { cn } from "@/lib/utils";
import { projectMergeQueue } from "@/server/merge-queue";
import { mergeQueue } from "@handoff/engine/operations";
import { getProjectDetail, listProjectGraphs, TEMPLATES } from "@/server/graphs";
import { DefaultLibrary } from "@/components/projects/default-library";
import { libraryChoices } from "@/server/library-choices";
import { isTodo, listBacklogOnce, type BacklogFilter } from "@/server/backlog";
import { listProjectPulls, type PullFilter } from "@/server/pulls";
import { runLines } from "@/server/run-lines";

export const dynamic = "force-dynamic";

type Detail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;

const repoUrl = (project: Detail["project"]) => `https://github.com/${project.repoOwner}/${project.repoName}`;
const graphPath = (projectId: string, name: string) => `/projects/${projectId}/graphs/${encodeURIComponent(name)}`;

async function RunsTab({ project, runs }: Pick<Detail, "project" | "runs">) {
  if (runs.length === 0) {
    return (
      <SectionCard>
        <Empty className="py-9">
          <EmptyHeader>
            <EmptyTitle>No runs yet</EmptyTitle>
            <EmptyDescription>Start one with New run.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SectionCard>
    );
  }
  const lines = await runLines(
    getDb(),
    runs.map((r) => r.id),
  );
  return (
    <SectionCard>
      <RunsTable runs={runs} lines={lines} repoUrl={repoUrl(project)} />
    </SectionCard>
  );
}

async function PullsTab({ projectId, repoUrl, filter }: { projectId: string; repoUrl: string; filter: PullFilter }) {
  const [pulls, queue] = await Promise.all([listProjectPulls(getDb(), getGitHub(), projectId, { state: filter }), projectMergeQueue(getDb(), projectId)]);
  const finished = (pr: PullItem) => !["queued", "running", "waiting"].includes(pr.runStatus);
  return (
    <div className="flex flex-col gap-4">
      <MergeQueue projectId={projectId} repoUrl={repoUrl} rows={queue} />
      <SectionCard
        title="Pull requests"
        description={pulls.live ? "Live state from GitHub for PRs opened by this project's runs." : "Set GITHUB_TOKEN or a GitHub App for the dashboard to show live CI and review state."}
        action={<PullFilters active={filter} counts={pulls.counts} />}
      >
        <PullRequestList
          items={pulls.items}
          emptyText={filter === "archived" ? "Nothing archived." : filter === "all" ? "No pull requests from handoff runs yet." : `No ${filter} pull requests.`}
          actions={(pr) => (finished(pr) ? <ArchivePullButton runId={pr.runId} number={pr.number} archived={pr.archived ?? false} /> : null)}
        />
      </SectionCard>
    </div>
  );
}

async function IssuesTab({ project, graphs, graphName, filter }: { project: Detail["project"]; graphs: string[]; graphName: string | undefined; filter: BacklogFilter }) {
  const backlog = await listBacklogOnce(project.id, getGitHub(), getDb(), getProjects());
  if ("error" in backlog || !graphName) {
    return (
      <SectionCard title={BACKLOG_TITLE} description={BACKLOG_DESCRIPTION}>
        <Empty className="pt-2 pb-9">
          <EmptyHeader>
            <EmptyTitle>{"error" in backlog ? "No issues to show" : "No graph to run"}</EmptyTitle>
            <EmptyDescription>{"error" in backlog ? backlog.error : "Create a graph under Graphs to start runs."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SectionCard>
    );
  }
  const issues = filter === "all" ? backlog.issues : backlog.issues.filter((i) => isTodo(i) === (filter === "todo"));
  return <Backlog projectId={project.id} graphs={graphs} graphName={graphName} filter={filter} counts={backlog.counts} issues={issues} repoUrl={repoUrl(project)} />;
}

/** The project's graphs, with New graph to start one from a template. */
async function GraphsTab({ projectId, defaultGraph }: { projectId: string; defaultGraph: string | undefined }) {
  const templates = Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label }));
  const graphs = await listProjectGraphs(getDb(), projectId);
  return (
    <SectionCard title="Graphs" description="Each save is a new version. Runs keep the version they started with." action={<NewGraphDialog projectId={projectId} templates={templates} />}>
      <GraphList projectId={projectId} graphs={graphs} defaultGraph={defaultGraph} />
    </SectionCard>
  );
}

function SettingsTab({ project, runCount, defaultGraph }: Pick<Detail, "project" | "defaultGraph"> & { runCount: number }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Project"
        description={
          <>
            The CLI refers to the project by its name. Runs branch off the default branch
            {project.setupCommand ? " and run the setup command in their worktree first." : "."}
          </>
        }
        action={
          <ProjectSettingsActions
            project={{
              id: project.id,
              name: project.name,
              repoOwner: project.repoOwner,
              repoName: project.repoName,
              defaultBranch: project.defaultBranch,
              isDemo: project.isDemo,
              runCount,
              setupCommand: project.setupCommand,
            }}
          />
        }
      >
        <dl className={cn(CARD_BODY, "grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]")}>
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-mono text-xs leading-5" data-voice-phrase={project.name}>
            {project.name}
          </dd>
          <dt className="text-muted-foreground">Repository</dt>
          <dd className="font-mono text-xs leading-5">
            {project.repoOwner}/{project.repoName}
          </dd>
          <dt className="text-muted-foreground">Default branch</dt>
          <dd className="font-mono text-xs leading-5">{project.defaultBranch}</dd>
          <dt className="text-muted-foreground">Setup command</dt>
          <dd className="font-mono text-xs leading-5 break-all">{project.setupCommand ?? <span className="font-sans text-[13px] text-muted-foreground">none</span>}</dd>
          <dt className="text-muted-foreground">Default graph</dt>
          <dd className="font-mono text-xs leading-5">
            {defaultGraph ? (
              <>
                {defaultGraph} <span className="font-sans text-[13px] text-muted-foreground">({runCount > 0 ? "the graph the latest run used" : "the graph changed last"})</span>
              </>
            ) : (
              <span className="font-sans text-[13px] text-muted-foreground">none</span>
            )}
          </dd>
        </dl>
      </SectionCard>
      <DefaultLibraryCard project={project} />
    </div>
  );
}

/** The library entries every run of the project gets, picked from the whole library. */
async function DefaultLibraryCard({ project }: { project: Detail["project"] }) {
  const available = await libraryChoices(getDb());
  return <DefaultLibrary key={JSON.stringify(project.library)} projectId={project.id} available={available} initial={project.library} />;
}

/** The number of issues still to do, for the Issues tab, as its To do filter counts them; nothing when GitHub cannot be asked. */
async function IssueCount({ projectId }: { projectId: string }) {
  const backlog = await listBacklogOnce(projectId, getGitHub(), getDb(), getProjects());
  return "error" in backlog ? null : <Count n={backlog.counts.todo} />;
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const tab = parseProjectTab(query);
  const [detail, queue] = await Promise.all([getProjectDetail(getDb(), projectId), mergeQueue(getDb(), projectId)]);
  if (!detail) notFound();
  const { project, graphs, runs, defaultGraph } = detail;
  const crumbs = await projectCrumbs(getDb(), project);
  const graph = graphs.find((g) => g.name === defaultGraph);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={crumbs}
        title={project.name}
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
      <ProjectTabs
        active={tab}
        counts={{ runs: runs.length, pulls: runs.filter((r) => r.prNumber !== null).length, graphs: graphs.length, ready: queue.length }}
        issueCount={
          project.isDemo ? null : (
            <Suspense fallback={null}>
              <IssueCount projectId={project.id} />
            </Suspense>
          )
        }
      >
        {tab === "runs" && <RunsTab project={project} runs={runs} />}
        {tab === "issues" && <IssuesTab project={project} graphs={graphs.map((g) => g.name)} graphName={defaultGraph} filter={parseBacklogFilter(query)} />}
        {tab === "pulls" && <PullsTab projectId={project.id} repoUrl={`https://github.com/${project.repoOwner}/${project.repoName}`} filter={parsePullFilter(query)} />}
        {tab === "graphs" && <GraphsTab projectId={project.id} defaultGraph={defaultGraph} />}
        {tab === "settings" && <SettingsTab project={project} runCount={runs.length} defaultGraph={defaultGraph} />}
      </ProjectTabs>
    </main>
  );
}
