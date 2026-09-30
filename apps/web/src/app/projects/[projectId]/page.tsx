import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { GraphSettingsDialog, NewGraphDialog, StartRunDialog } from "@/components/projects/forms";
import { Backlog } from "@/components/projects/backlog";
import { ProjectSettingsActions } from "@/components/projects/project-card";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { PullRequestList, type PullItem } from "@/components/pulls/pr-list";
import { ArchivePullButton, PullFilters } from "@/components/pulls/pull-filters";
import { IssueLinks } from "@/components/runs/issue-links";
import { StatusBadge } from "@/components/runs/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";
import { parseBacklogFilter, parseProjectTab } from "@/lib/project-tab";
import { parsePullFilter } from "@/lib/pull-filter";
import { listLibraryIndex } from "@handoff/db";
import { getProjectDetail, TEMPLATES } from "@/server/graphs";
import { DefaultLibrary } from "@/components/projects/default-library";
import { isTodo, listBacklog, type BacklogFilter } from "@/server/backlog";
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
                    <Link href={`/runs/${run.id}`} className="truncate hover:underline">
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
  const backlog = await listBacklog(getDb(), getGitHub(), project.id);
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
  const { skills, mcp, agents, groups } = await listLibraryIndex(getDb());
  const available = {
    skills: skills.map((s) => ({ name: s.name, detail: s.description })),
    mcp: mcp.map((m) => ({ name: m.name, detail: m.url ?? `${m.command} ${m.args.join(" ")}` })),
    agents: agents.map((a) => ({ name: a.name, detail: a.description })),
    groups: groups.map((g) => ({ name: g.name, detail: g.description || [...g.skills, ...g.mcp, ...g.agents].join(", ") })),
  };
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

function SettingsTab({ project, graphs, runCount }: Pick<Detail, "project" | "graphs"> & { runCount: number }) {
  const templates = Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label }));
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Project</CardTitle>
          <CardDescription>The CLI refers to the project by its name. Runs branch off the default branch.</CardDescription>
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
      <Card>
        <CardHeader>
          <CardTitle>Graphs</CardTitle>
          <CardDescription>Each save is a new version. Runs keep the version they started with.</CardDescription>
          <CardAction>
            <NewGraphDialog projectId={project.id} templates={templates} />
          </CardAction>
        </CardHeader>
        <CardContent>
          {graphs.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No graphs yet</EmptyTitle>
                <EmptyDescription>Create one from a template with New graph.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableBody>
                {graphs.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-mono">{g.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">v{g.latestVersion}</Badge>
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/projects/${project.id}/graphs/${g.name}`}>
                          <PencilIcon data-icon="inline-start" />
                          Edit
                        </Link>
                      </Button>
                      <GraphSettingsDialog projectId={project.id} graphName={g.name} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
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
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <a className="font-mono text-sm text-muted-foreground hover:underline" href={`https://github.com/${project.repoOwner}/${project.repoName}`}>
            {project.repoOwner}/{project.repoName}
          </a>
        </div>
        {!project.isDemo && defaultGraph && (
          <StartRunDialog projectId={project.id} graphs={graphs.map((g) => g.name)} graphName={defaultGraph} label="New run" size="default" />
        )}
      </div>
      <ProjectTabs active={tab} counts={{ runs: runs.length, pulls: runs.filter((r) => r.prNumber !== null).length }}>
        {tab === "runs" && <RunsTab project={project} runs={runs} />}
        {tab === "issues" && (
          <IssuesTab project={project} graphs={graphs.map((g) => g.name)} graphName={defaultGraph} filter={parseBacklogFilter(query)} />
        )}
        {tab === "pulls" && <PullsTab projectId={project.id} filter={parsePullFilter(query)} />}
        {tab === "settings" && <SettingsTab project={project} graphs={graphs} runCount={runs.length} />}
      </ProjectTabs>
    </main>
  );
}
