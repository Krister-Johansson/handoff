import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { projectCrumbs } from "@/server/crumbs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewGraphDialog, StartRunDialog } from "@/components/projects/forms";
import { Backlog } from "@/components/projects/backlog";
import { ProjectSettingsActions } from "@/components/projects/project-card";
import { GraphList } from "@/components/projects/graph-list";
import { Count, ProjectTabs } from "@/components/projects/project-tabs";
import { PullRequestList, type PullItem } from "@/components/pulls/pr-list";
import { ArchivePullButton, PullFilters } from "@/components/pulls/pull-filters";
import { IssueLinks } from "@/components/runs/issue-links";
import { StatusBadge } from "@/components/runs/status-badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { runPath } from "@/lib/paths";
import { getGitHub } from "@/lib/github";
import { parseBacklogFilter, parseProjectTab } from "@/lib/project-tab";
import { parsePullFilter } from "@/lib/pull-filter";
import { getProjectDetail, listProjectGraphs, TEMPLATES } from "@/server/graphs";
import { DefaultLibrary } from "@/components/projects/default-library";
import { libraryChoices } from "@/server/library-choices";
import { isTodo, listBacklogOnce, type BacklogFilter } from "@/server/backlog";
import { listProjectPulls, type PullFilter } from "@/server/pulls";

export const dynamic = "force-dynamic";

type Detail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;

function RunsTab({ project, runs }: Pick<Detail, "project" | "runs">) {
  if (runs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No runs yet</EmptyTitle>
          <EmptyDescription>Start one with New run.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>PR</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="w-full max-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link href={runPath(project.id, run.id)} className="truncate hover:underline">
                      {run.task}
                    </Link>
                    <IssueLinks issues={run.issues} className="shrink-0" />
                  </div>
                </TableCell>
                <TableCell className="max-w-56 truncate font-mono text-xs">{run.branchName}</TableCell>
                <TableCell>
                  {run.prNumber !== null ? (
                    <a className="hover:underline" href={`https://github.com/${project.repoOwner}/${project.repoName}/pull/${run.prNumber}`}>
                      #{run.prNumber}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">none</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <StatusBadge status={run.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function PullsTab({ projectId, filter }: { projectId: string; filter: PullFilter }) {
  const pulls = await listProjectPulls(getDb(), getGitHub(), projectId, { state: filter });
  const finished = (pr: PullItem) => !["queued", "running", "waiting"].includes(pr.runStatus);
  return (
    <Card>
      <CardHeader>
        <CardDescription>
          {pulls.live ? "Live state from GitHub for PRs opened by this project's runs." : "Set GITHUB_TOKEN or a GitHub App for the dashboard to show live CI and review state."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PullFilters active={filter} counts={pulls.counts} />
        <PullRequestList
          items={pulls.items}
          emptyText={filter === "archived" ? "Nothing archived." : filter === "all" ? "No pull requests from handoff runs yet." : `No ${filter} pull requests.`}
          actions={(pr) => (finished(pr) ? <ArchivePullButton runId={pr.runId} number={pr.number} archived={pr.archived ?? false} /> : null)}
        />
      </CardContent>
    </Card>
  );
}

async function IssuesTab({ project, graphs, graphName, filter }: { project: Detail["project"]; graphs: string[]; graphName: string | undefined; filter: BacklogFilter }) {
  const backlog = await listBacklogOnce(project.id, getGitHub(), getDb());
  if ("error" in backlog) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No issues to show</EmptyTitle>
          <EmptyDescription>{backlog.error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const issues = filter === "all" ? backlog.issues : backlog.issues.filter((i) => isTodo(i) === (filter === "todo"));
  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Open issues on GitHub. Write them there, by hand or with Claude Code, and start a run for one when you want it worked on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {graphName ? (
          <Backlog
            projectId={project.id}
            graphs={graphs}
            graphName={graphName}
            filter={filter}
            counts={backlog.counts}
            issues={issues}
            repoUrl={`https://github.com/${project.repoOwner}/${project.repoName}`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Create a graph under Settings to start runs.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** The library entries every run of the project gets, picked from the whole library. */
async function DefaultLibraryCard({ project }: { project: Detail["project"] }) {
  const available = await libraryChoices(getDb());
  return (
    <Card>
      <CardHeader>
        <CardTitle>Default library</CardTitle>
        <CardDescription>Every planner, coder and reviewer in this project&apos;s runs gets these, on top of what each node enables.</CardDescription>
      </CardHeader>
      <CardContent>
        <DefaultLibrary key={JSON.stringify(project.library)} projectId={project.id} available={available} initial={project.library} />
      </CardContent>
    </Card>
  );
}

/** The project's graphs, with New graph to start one from a template. */
async function GraphsTab({ projectId, defaultGraph }: { projectId: string; defaultGraph: string | undefined }) {
  const templates = Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label }));
  const graphs = await listProjectGraphs(getDb(), projectId);
  return (
    <Card>
      <CardHeader>
        <CardDescription>Each save is a new version. Runs keep the version they started with.</CardDescription>
        <CardAction>
          <NewGraphDialog projectId={projectId} templates={templates} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <GraphList projectId={projectId} graphs={graphs} defaultGraph={defaultGraph} />
      </CardContent>
    </Card>
  );
}

function SettingsTab({ project, runCount }: Pick<Detail, "project"> & { runCount: number }) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Project</CardTitle>
          <CardDescription>
            The CLI refers to the project by its name. Runs branch off the default branch
            {project.setupCommand ? (
              <>
                {" "}and run <code className="font-mono text-xs">{project.setupCommand}</code> in their worktree first.
              </>
            ) : (
              "."
            )}
          </CardDescription>
          <CardAction>
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
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-mono">{project.name}</dd>
            <dt className="text-muted-foreground">Repository</dt>
            <dd className="font-mono">
              {project.repoOwner}/{project.repoName}
            </dd>
            <dt className="text-muted-foreground">Default branch</dt>
            <dd className="font-mono">{project.defaultBranch}</dd>
          </dl>
        </CardContent>
      </Card>
      <DefaultLibraryCard project={project} />
    </div>
  );
}

/** The number of issues still to do, for the Issues tab, as its To do filter counts them; nothing when GitHub cannot be asked. */
async function IssueCount({ projectId }: { projectId: string }) {
  const backlog = await listBacklogOnce(projectId, getGitHub(), getDb());
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
  const detail = await getProjectDetail(getDb(), projectId);
  if (!detail) notFound();
  const { project, graphs, runs, defaultGraph } = detail;
  const crumbs = await projectCrumbs(getDb(), project);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={crumbs}
        title={project.name}
        description={
          <a className="font-mono hover:underline" href={`https://github.com/${project.repoOwner}/${project.repoName}`}>
            {project.repoOwner}/{project.repoName}
          </a>
        }
        actions={
          !project.isDemo &&
          defaultGraph && <StartRunDialog projectId={project.id} graphs={graphs.map((g) => g.name)} graphName={defaultGraph} label="New run" size="default" />
        }
      />
      <ProjectTabs
        active={tab}
        counts={{ runs: runs.length, pulls: runs.filter((r) => r.prNumber !== null).length, graphs: graphs.length }}
        issueCount={
          project.isDemo ? null : (
            <Suspense fallback={null}>
              <IssueCount projectId={project.id} />
            </Suspense>
          )
        }
      >
        {tab === "runs" && <RunsTab project={project} runs={runs} />}
        {tab === "issues" && (
          <IssuesTab project={project} graphs={graphs.map((g) => g.name)} graphName={defaultGraph} filter={parseBacklogFilter(query)} />
        )}
        {tab === "pulls" && <PullsTab projectId={project.id} filter={parsePullFilter(query)} />}
        {tab === "graphs" && <GraphsTab projectId={project.id} defaultGraph={defaultGraph} />}
        {tab === "settings" && <SettingsTab project={project} runCount={runs.length} />}
      </ProjectTabs>
    </main>
  );
}
