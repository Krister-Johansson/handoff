import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { GraphSettingsDialog, NewGraphDialog, StartRunDialog } from "@/components/projects/forms";
import { ProjectSettingsActions } from "@/components/projects/project-card";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { PullRequestList } from "@/components/pulls/pr-list";
import { StatusBadge } from "@/components/runs/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";
import { parseProjectTab } from "@/lib/project-tab";
import { getProjectDetail, TEMPLATES } from "@/server/graphs";
import { listProjectPulls } from "@/server/pulls";

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
                <TableCell className="w-full max-w-0 truncate">
                  <Link href={`/runs/${run.id}`} className="hover:underline">
                    {run.task}
                  </Link>
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

async function PullsTab({ projectId }: { projectId: string }) {
  const pulls = await listProjectPulls(getDb(), getGitHub(), projectId);
  return (
    <Card>
      <CardHeader>
        <CardDescription>
          {pulls.live ? "Live state from GitHub for PRs opened by this project's runs." : "Set GITHUB_TOKEN or a GitHub App for the dashboard to show live CI and review state."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PullRequestList items={pulls.items} />
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
  const { project, graphs, runs } = detail;
  const latestGraph = [...graphs].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <a className="font-mono text-sm text-muted-foreground hover:underline" href={`https://github.com/${project.repoOwner}/${project.repoName}`}>
            {project.repoOwner}/{project.repoName}
          </a>
        </div>
        {!project.isDemo && latestGraph && (
          <StartRunDialog projectId={project.id} graphs={graphs.map((g) => g.name)} graphName={latestGraph.name} label="New run" size="default" />
        )}
      </div>
      <ProjectTabs active={tab} counts={{ runs: runs.length, pulls: runs.filter((r) => r.prNumber !== null).length }}>
        {tab === "runs" && <RunsTab project={project} runs={runs} />}
        {tab === "pulls" && <PullsTab projectId={project.id} />}
        {tab === "settings" && <SettingsTab project={project} graphs={graphs} runCount={runs.length} />}
      </ProjectTabs>
    </main>
  );
}
