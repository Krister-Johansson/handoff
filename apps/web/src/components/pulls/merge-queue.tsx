"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { GitMergeIcon } from "lucide-react";
import { requestMergeAction, requestMergeAllAction } from "@/app/projects/actions";
import { SectionCard } from "@/components/section-card";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { runPath } from "@/lib/paths";
import { cn } from "@/lib/utils";

/** One pull request in the project's merge queue, as the Pull requests tab lists it. */
export type QueueRow = {
  runId: string;
  task: string;
  prNumber: number | null;
  issues: { number: number; title: string; url: string }[];
  queuedAt: Date;
  requested: boolean;
  position: number;
  waiting: boolean;
  /** Whether the run's merge step waits for a person, or merges on its own in turn. */
  mode: "manual" | "auto";
};

/** Where a row stands: catching up with main, about to merge, asked for, or ready for a person. */
function standing(row: QueueRow): { text: string; tone: "active" | "success" | "outline" } {
  if (!row.waiting) return { text: "Catching up with main", tone: "active" };
  if (row.position === 1 && (row.requested || row.mode === "auto")) return { text: "Merging next", tone: "success" };
  if (row.requested) return { text: "Merge requested", tone: "outline" };
  if (row.mode === "auto") return { text: "Merges on its own in turn", tone: "outline" };
  return { text: "Ready", tone: "success" };
}

/**
 * The project's merge queue: ready pull requests in the order they will merge. Only the first can merge
 * now; each is brought up to date with main at its turn. Merge all asks for every one, in order.
 */
export function MergeQueue({ projectId, repoUrl, rows }: { projectId: string; repoUrl: string; rows: QueueRow[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (rows.length === 0) return null;
  const run = (action: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      const result = await action();
      setError(result.ok ? undefined : result.error);
    });
  const manualWaiting = rows.some((r) => r.mode === "manual" && !r.requested);
  return (
    <SectionCard
      title="Ready to merge"
      description="Pull requests merge one at a time, in this order, each brought up to date with main first."
      action={
        manualWaiting && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => requestMergeAllAction({ projectId }))}>
            <GitMergeIcon data-icon="inline-start" />
            Merge all in order
          </Button>
        )
      }
    >
      <ol className="flex flex-col divide-y border-t">
        {rows.map((row) => {
          const { text, tone } = standing(row);
          const canMerge = row.position === 1 && row.waiting && row.mode === "manual" && !row.requested;
          return (
            <li key={row.runId} className="flex min-w-0 items-center gap-3 px-5 py-2.5">
              <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground tabular-nums">{row.position}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link href={runPath(projectId, row.runId)} className="truncate font-medium hover:underline hover:underline-offset-3">
                  {row.task}
                </Link>
                {row.prNumber !== null && (
                  <a href={`${repoUrl}/pull/${row.prNumber}`} className="w-fit font-mono text-xs text-muted-foreground hover:underline">
                    #{row.prNumber}
                  </a>
                )}
              </div>
              <Tag tone={tone} className={cn(tone === "active" && "animate-pulse")}>
                {text}
              </Tag>
              {canMerge && (
                <Button size="sm" disabled={pending} aria-label={`Merge #${row.prNumber}`} onClick={() => run(() => requestMergeAction({ runId: row.runId, projectId }))}>
                  Merge
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      {error && <p className="px-5 py-2 text-sm text-danger">{error}</p>}
    </SectionCard>
  );
}
