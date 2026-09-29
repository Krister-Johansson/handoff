import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { NewGraphForm, StartRunDialog } from "@/components/projects/forms";
import { StatusBadge } from "@/components/runs/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PullRequestList } from "@/components/pulls/pr-list";
import { getDb } from "@/lib/db";
import { getGitHub } from "@/lib/github";
import { listProjectPulls } from "@/server/pulls";
import { getProjectDetail, TEMPLATES } from "@/server/graphs";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const [detail, pulls] = await Promise.all([getProjectDetail(db, projectId), listProjectPulls(db, getGitHub(), projectId)]);
  if (!detail) notFound();
  const { project, graphs, runs } = detail;
  const templates = Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label }));
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <a className="font-mono text-sm text-muted-foreground hover:underline" href={`https://github.com/${project.repoOwner}/${project.repoName}`}>
          {project.repoOwner}/{project.repoName}
        </a>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Pull requests</CardTitle>
          <CardDescription>
            {pulls.live ? "Live state from GitHub for PRs opened by this project's runs." : "Set GITHUB_TOKEN or a GitHub App for the dashboard to show live CI and review state."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PullRequestList items={pulls.items} />
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Graphs</CardTitle>
            <CardDescription>Each save is a new version. Runs keep the version they started with.</CardDescription>
          </CardHeader>
          <CardContent>
            {graphs.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No graphs yet</EmptyTitle>
                  <EmptyDescription>Create one from a template.</EmptyDescription>
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
                        <StartRunDialog projectId={project.id} graphName={g.name} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>New graph</CardTitle>
          </CardHeader>
          <CardContent>
            <NewGraphForm projectId={project.id} templates={templates} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
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
                    <TableCell className="max-w-72 truncate">
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
          )}
        </CardContent>
      </Card>
    </main>
  );
}
