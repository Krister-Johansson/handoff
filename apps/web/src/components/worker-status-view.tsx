import { cn } from "@/lib/utils";

/** Header indicator: green when a worker heartbeats, red when runs are queued with nobody to run them. */
export function WorkerStatusView({ live, queuedRuns }: { live: number; queuedRuns: number }) {
  const online = live > 0;
  const label = online ? `${live} ${live === 1 ? "worker" : "workers"} online` : "No worker running";
  const hint = online ? "The worker claims queued nodes." : queuedRuns > 0 ? `${queuedRuns} queued runs are waiting. Start one with pnpm dev:worker.` : "Start one with pnpm dev:worker.";
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={hint}>
      <span className={cn("size-[7px] rounded-full", online ? "bg-success-dot" : queuedRuns > 0 ? "bg-danger-dot" : "bg-muted-foreground/40")} />
      {label}
    </span>
  );
}
