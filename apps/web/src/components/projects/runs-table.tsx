import Link from "next/link";
import { IssueLinks, type IssueLink } from "@/components/runs/issue-links";
import { StatusBadge } from "@/components/runs/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAgo, formatCost } from "@/lib/format";
import { runPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { RunLine } from "@/server/run-lines";
import { TD, TH } from "@/components/section-card";

export type ProjectRun = {
  id: string;
  projectId: string;
  task: string;
  issues: IssueLink[];
  status: string;
  branchName: string;
  prNumber: number | null;
  createdAt: Date;
};

/** A project's runs, newest first: task with what it is doing now, graph version, branch, PR, cost, start and status. */
export function RunsTable({ runs, lines, repoUrl, now = new Date() }: { runs: ProjectRun[]; lines: Map<string, RunLine>; repoUrl: string; now?: Date }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={TH}>Task</TableHead>
          <TableHead className={TH}>Graph</TableHead>
          <TableHead className={TH}>Branch</TableHead>
          <TableHead className={TH}>PR</TableHead>
          <TableHead className={cn(TH, "text-right")}>Cost</TableHead>
          <TableHead className={TH}>Started</TableHead>
          <TableHead className={cn(TH, "text-right")}>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const line = lines.get(run.id);
          return (
            <TableRow key={run.id} className="hover:bg-muted">
              <TableCell className={cn(TD, "w-full max-w-0")}>
                <div className="flex min-w-0 items-center gap-2">
                  <Link href={runPath(run.projectId, run.id)} className="truncate font-medium hover:underline hover:underline-offset-3">
                    {run.task}
                  </Link>
                  <IssueLinks issues={run.issues} className="shrink-0" />
                </div>
                {line && <div className={cn("truncate text-xs", line.now.tone === "danger" ? "text-danger" : "text-muted-foreground")}>{line.now.text}</div>}
              </TableCell>
              <TableCell className={cn(TD, "font-mono text-xs text-muted-foreground")}>{line && `${line.graph} v${line.version}`}</TableCell>
              <TableCell className={cn(TD, "max-w-56 truncate font-mono text-xs text-muted-foreground")}>{run.branchName}</TableCell>
              <TableCell className={TD}>
                {run.prNumber !== null ? (
                  <a className="font-mono text-xs hover:underline hover:underline-offset-3" href={`${repoUrl}/pull/${run.prNumber}`}>
                    #{run.prNumber}
                  </a>
                ) : (
                  <span className="text-muted-foreground">none</span>
                )}
              </TableCell>
              <TableCell className={cn(TD, "text-right text-muted-foreground tabular-nums")} title={line?.costUsd ? "Client-side estimate reported by the Claude CLI" : undefined}>
                {line?.costUsd ? formatCost(line.costUsd) : ""}
              </TableCell>
              <TableCell className={cn(TD, "text-muted-foreground")} title={run.createdAt.toISOString()}>
                {formatAgo(run.createdAt, now)}
              </TableCell>
              <TableCell className={cn(TD, "text-right")}>
                <StatusBadge status={run.status} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
