import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/runs/status-badge";
import { getDb } from "@/lib/db";
import { listRuns } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const rows = await listRuns(getDb());
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <CardDescription>Every graph execution, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No runs yet</EmptyTitle>
                <EmptyDescription>Start one with pnpm handoff run, or seed a demo run with pnpm demo.</EmptyDescription>
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
                    <TableCell className="w-full max-w-0 truncate font-medium">
                      <Link href={`/runs/${run.id}`} className="hover:underline">
                        {run.task}
                      </Link>
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
