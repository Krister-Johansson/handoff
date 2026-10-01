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
