import { cn } from "@/lib/utils";
import { workerLabel } from "@/lib/worker-status";

/** The sidebar's worker status: green when a worker heartbeats, red when runs are queued with nobody to run them. */
export function WorkerStatusView({ live, queuedRuns }: { live: number; queuedRuns: number }) {
  const online = live > 0;
  const label = workerLabel(live);
  const hint = online ? "The worker claims queued nodes." : queuedRuns > 0 ? `${queuedRuns} queued runs are waiting. Start one with pnpm dev:worker.` : "Start one with pnpm dev:worker.";
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" title={hint}>
      {/* The dot sits in an icon-sized box, so it lines up with the icons above and stays when collapsed. */}
      <span aria-hidden className="grid size-4 shrink-0 place-items-center">
        <span className={cn("size-[7px] rounded-full", online ? "bg-success-dot" : queuedRuns > 0 ? "bg-danger-dot" : "bg-muted-foreground/40")} />
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}
