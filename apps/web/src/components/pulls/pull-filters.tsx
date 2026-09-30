"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { archivePullAction, unarchivePullAction, type ActionState } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { PULL_FILTERS } from "@/lib/pull-filter";
import type { PullCounts, PullFilter } from "@/server/pulls";

/** Open, Merged, Closed, All and Archived as links with counts; the filter lives in ?pr=. */
export function PullFilters({ active, counts }: { active: PullFilter; counts: PullCounts }) {
  return (
    <nav aria-label="Pull request state" className="flex flex-wrap gap-1">
      {PULL_FILTERS.map((f) => {
        const current = f.value === active;
        return (
          <Button key={f.value} asChild size="sm" variant={current ? "secondary" : "ghost"}>
            <Link href={`?tab=pulls&pr=${f.value}`} scroll={false} aria-current={current ? "page" : undefined}>
              {f.label} <span className="text-muted-foreground tabular-nums">{counts[f.value]}</span>
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

/** Hides a finished run's pull request from the lists, or brings it back from Archived. */
export function ArchivePullButton({ runId, number, archived }: { runId: string; number: number; archived: boolean }) {
  const [state, action, pending] = useActionState(archived ? unarchivePullAction : archivePullAction, {} as ActionState);
  const label = `${archived ? "Unarchive" : "Archive"} #${number}`;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="runId" value={runId} />
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      <Button type="submit" size="icon-sm" variant="ghost" aria-label={label} title={label} disabled={pending}>
        {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
      </Button>
    </form>
  );
}
