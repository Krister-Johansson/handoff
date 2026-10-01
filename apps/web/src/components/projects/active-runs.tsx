import Link from "next/link";
import { GitPullRequestIcon } from "lucide-react";
import { StatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { formatAgo } from "@/lib/format";
import { runPath } from "@/lib/paths";
import type { RunLine } from "@/server/run-lines";
import { ROW, ROWS } from "@/components/section-card";
import { Tag } from "@/components/tag";

export type ActiveRun = { id: string; projectId: string; task: string; status: string; project: string; prNumber: number | null; createdAt: Date };

/** Active runs across projects: status, task, what the run is doing now, its project, and a way to act. */
export function ActiveRunList({ runs, lines, now = new Date() }: { runs: ActiveRun[]; lines: Map<string, RunLine>; now?: Date }) {
  return (
    <ul className={ROWS}>
      {runs.map((run) => {
        const line = lines.get(run.id);
        return (
          <li key={run.id} className={ROW}>
            <StatusBadge status={run.status} />
            <div className="flex min-w-0 flex-1 flex-col gap-px">
              <Link href={runPath(run.projectId, run.id)} className="truncate font-medium hover:underline hover:underline-offset-3">
                {run.task}
              </Link>
              <span className="truncate text-xs text-muted-foreground">{[line?.now.text, formatAgo(run.createdAt, now)].filter(Boolean).join(" · ")}</span>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{run.project}</span>
            {line?.reviewHref ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={line.reviewHref}>Open the review</Link>
              </Button>
            ) : (
              run.prNumber !== null && (
                <Tag mono>
                  <GitPullRequestIcon aria-hidden />#{run.prNumber}
                </Tag>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}
