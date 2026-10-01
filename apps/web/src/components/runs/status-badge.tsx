import { statusTone, TONE_CLASS } from "@/lib/status";
import { cn } from "@/lib/utils";

/** A run or node status as a pill in its tone's colour, with a dot that pulses while running. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = statusTone(status);
  return (
    <span data-tone={tone} className={cn("inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap", TONE_CLASS[tone])}>
      {tone !== "neutral" && tone !== "muted" && <span aria-hidden className={cn("size-1.5 rounded-full bg-current", tone === "active" && "animate-pulse")} />}
      {label ?? status.replaceAll("_", " ")}
    </span>
  );
}
