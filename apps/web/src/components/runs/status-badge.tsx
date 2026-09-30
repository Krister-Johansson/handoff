import { Badge } from "@/components/ui/badge";
import { statusTone, TONE_CLASS } from "@/lib/status";
import { cn } from "@/lib/utils";

/** A run or node status in its tone's color; running statuses pulse. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = statusTone(status);
  return (
    <Badge variant="outline" data-tone={tone} className={cn("gap-1.5", TONE_CLASS[tone])}>
      {tone === "active" && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />}
      {label ?? status.replaceAll("_", " ")}
    </Badge>
  );
}
