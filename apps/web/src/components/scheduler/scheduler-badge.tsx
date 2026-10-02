import type { SchedulerState } from "@/server/scheduler";
import { TONE_CLASS, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

const LABEL: Record<SchedulerState, string> = { off: "Off", running: "Running", held: "Held", idle: "Idle", paused: "Paused" };
const TONE: Record<SchedulerState, StatusTone> = { off: "neutral", running: "active", held: "attention", idle: "muted", paused: "muted" };

/** "Scheduler held, 1 of 2" on a project's row in Settings, Projects; paused says only that. */
export function SchedulerRowTag({ brief }: { brief: { state: SchedulerState; active: number; maxRuns: number } }) {
  const text = brief.state === "paused" ? "Scheduler paused" : `Scheduler ${LABEL[brief.state].toLowerCase()}, ${brief.active} of ${brief.maxRuns}`;
  return (
    <span data-tone={TONE[brief.state]} title="Open the scheduler in Project settings" className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 text-xs font-medium whitespace-nowrap text-secondary-foreground">
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[TONE[brief.state]])} />
      {text}
    </span>
  );
}

const DOT: Record<StatusTone, string> = {
  active: "bg-active-dot",
  attention: "bg-attention-dot",
  danger: "bg-danger-dot",
  success: "bg-success-dot",
  neutral: "bg-muted-foreground",
  muted: "bg-muted-foreground",
  repaired: "bg-muted-foreground",
};

/** The scheduler's state as a pill with its word; a pause the scheduler made itself after failed starts is red. */
export function SchedulerBadge({ state, selfPaused = false }: { state: SchedulerState; selfPaused?: boolean }) {
  const tone = selfPaused ? "danger" : TONE[state];
  return (
    <span data-tone={tone} className={cn("inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap", TONE_CLASS[tone])}>
      <span aria-hidden className={cn("size-1.5 rounded-full bg-current", state === "running" && "animate-pulse")} />
      {LABEL[state]}
    </span>
  );
}
