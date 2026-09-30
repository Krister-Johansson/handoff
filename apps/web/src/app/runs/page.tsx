import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunFilters } from "@/components/runs/run-filters";
import { IssueLinks } from "@/components/runs/issue-links";
import { StatusBadge } from "@/components/runs/status-badge";
import { getDb } from "@/lib/db";
import { parseRunFilter } from "@/lib/run-filter";
import { listProjects } from "@/server/graphs";
import { listRuns } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = parseRunFilter(await searchParams);
  const db = getDb();
  const [rows, projectRows] = await Promise.all([listRuns(db, filter), listProjects(db)]);
  const filtered = filter.status !== undefined || filter.project !== undefined;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <CardDescription>Graph executions, newest first. The last 50 that match the filter.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RunFilters filter={filter} projects={projectRows.map((p) => p.name)} />
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{filtered ? "No runs match" : "No runs yet"}</EmptyTitle>
                <EmptyDescription>
                  {filtered ? "Try another status or project." : "Start one with pnpm handoff run, or seed a demo run with pnpm demo."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="w-full max-w-0 font-medium">
                      <div className="flex min-w-0 items-center gap-2">
                        <Link href={`/runs/${run.id}`} className="truncate hover:underline">
                          {run.task}
                        </Link>
                        <IssueLinks issues={run.issues} className="shrink-0" />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.owner}/{run.repo}
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-mono text-xs">{run.branchName}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{run.createdAt.toLocaleString()}</TableCell>
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
