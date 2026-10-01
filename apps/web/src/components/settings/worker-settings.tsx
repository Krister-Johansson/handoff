import type { ReactNode } from "react";
import { StatusBadge } from "@/components/runs/status-badge";

export type WorkerRow = { id: string; hostname: string; caps: Record<string, number>; startedAt: Date; heartbeatAt: Date };

const time = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** "4 s ago", from the worker's last heartbeat to when the page was rendered. */
const ago = (then: Date, now: Date) => `${Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000))} s ago`;

/** How many nodes of each kind the worker runs at once, as "cli 1, shell 4". */
const capacity = (caps: Record<string, number>) =>
  Object.entries(caps)
    .map(([kind, n]) => `${kind} ${n}`)
    .join(", ");

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** The workers that claim queued nodes: each live one with its host, heartbeat and capacity, or how to start one. */
export function WorkerSettings({ workers, queuedRuns, now }: { workers: WorkerRow[]; queuedRuns: number; now: Date }) {
  const label = workers.length > 0 ? `${workers.length} ${workers.length === 1 ? "worker" : "workers"} online` : "No worker running";
  return (
    <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
      <Row label="Status">
        <StatusBadge status={workers.length > 0 ? "succeeded" : queuedRuns > 0 ? "failed" : "cancelled"} label={label} />
      </Row>
      {workers.map((w) => (
        <Row key={w.id} label="Worker">
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-xs">{w.hostname}</span>
            <span className="text-xs text-muted-foreground">heartbeat {ago(w.heartbeatAt, now)}</span>
            <span className="text-xs text-muted-foreground">started {time.format(w.startedAt)}</span>
            <span className="text-xs text-muted-foreground">
              Runs at once: <span className="font-mono">{capacity(w.caps)}</span>
            </span>
          </span>
        </Row>
      ))}
      <Row label="Queued runs">{queuedRuns === 0 ? "None" : queuedRuns === 1 ? "1 queued run is waiting." : `${queuedRuns} queued runs are waiting.`}</Row>
      <Row label="Start one">
        <code className="rounded border bg-subtle px-1.5 py-0.5 font-mono text-xs">pnpm dev:worker</code>
      </Row>
    </dl>
  );
}
