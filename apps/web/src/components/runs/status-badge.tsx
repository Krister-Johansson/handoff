import { statusTone, TONE_CLASS } from "@/lib/status";
import { cn } from "@/lib/utils";

/** A run or node status as a pill in its tone's colour, with a dot that pulses while running; `sm` on graph nodes. */
export function StatusBadge({ status, label, size = "default" }: { status: string; label?: string; size?: "default" | "sm" }) {
  const tone = statusTone(status);
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-[18px] px-1.5 text-[10px]" : "h-[22px] px-2 text-xs",
        TONE_CLASS[tone],
      )}
    >
      {tone !== "neutral" && tone !== "muted" && <span aria-hidden className={cn("size-1.5 rounded-full bg-current", tone === "active" && "animate-pulse")} />}
      {label ?? status.replaceAll("_", " ")}
    </span>
  );
}

/** What a run waits on while its status stays running: a step's open permission request. */
export type RunWaitingOn = { kind: "permission"; nodeKey: string; since: Date };

/** A run's status. A run whose step waits on a permission request shows that in the attention tone; its status stays running. */
export function RunStatusBadge({ status, waitingOn, size }: { status: string; waitingOn?: RunWaitingOn | null | undefined; size?: "default" | "sm" }) {
  return waitingOn ? <StatusBadge status="waiting" label="waiting on permission" size={size} /> : <StatusBadge status={status} size={size} />;
}
