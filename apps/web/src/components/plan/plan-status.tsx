import { LoaderCircleIcon } from "lucide-react";
import type { PlanKind } from "@handoff/github";
import type { PlanColumn, PlanProgress } from "@/server/plan";
import { COLUMN_TONE } from "@/lib/plan/task";
import { cn } from "@/lib/utils";

/** A task's Status as a pill that always carries the word; Running spins while a run is active. */
export function StatusPill({ column, spinning }: { column: PlanColumn; spinning?: boolean }) {
  return (
    <span
      data-column={column}
      className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap", COLUMN_TONE[column].pill)}
    >
      {spinning ? <LoaderCircleIcon aria-hidden className="size-3 animate-spin" /> : <span aria-hidden className={cn("size-1.5 rounded-full", COLUMN_TONE[column].dot)} />}
      {column}
    </span>
  );
}

const KIND_LABEL: Record<PlanKind, string> = { epic: "Epic", story: "Story", task: "Task" };

/** The small upper-case badge naming an epic or a story. */
export function KindBadge({ kind }: { kind: PlanKind }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-[4px] border px-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
      {KIND_LABEL[kind]}
    </span>
  );
}

/** Done first, then the work in flight, then what waits. */
const SEGMENTS: PlanColumn[] = ["Done", "In review", "Running", "Ready", "Shaping", "Other"];

/** A bar of segments coloured by status, Done first, each as wide as its share of the tasks. */
export function StatusSegments({ byStatus, total, className }: { byStatus: Record<PlanColumn, number>; total: number; className?: string }) {
  const parts = SEGMENTS.filter((c) => byStatus[c] > 0);
  return (
    <span role="img" aria-label={total ? parts.map((c) => `${byStatus[c]} ${c}`).join(", ") : "No tasks"} className={cn("flex h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      {parts.map((c) => (
        <span key={c} className={cn("h-full", COLUMN_TONE[c].dot)} style={{ width: `${(byStatus[c] / total) * 100}%` }} />
      ))}
    </span>
  );
}

/** Five segments coloured by status, Done first, with "3 of 8 done" beside them. */
export function ProgressBar({ progress, className }: { progress: PlanProgress; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-2.5", className)}>
      <StatusSegments byStatus={progress.byStatus} total={progress.total} className="w-16 sm:w-[72px]" />
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {progress.done} of {progress.total} done
      </span>
    </span>
  );
}
