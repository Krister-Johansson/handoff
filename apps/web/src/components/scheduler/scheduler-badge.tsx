import type { SchedulerState } from "@/server/scheduler";
import { TONE_CLASS, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

const LABEL: Record<SchedulerState, string> = { off: "Off", running: "Running", held: "Held", idle: "Idle", paused: "Paused" };
const TONE: Record<SchedulerState, StatusTone> = { off: "neutral", running: "active", held: "attention", idle: "muted", paused: "muted" };

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
