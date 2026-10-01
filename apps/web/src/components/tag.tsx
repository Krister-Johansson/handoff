import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type TagTone = "outline" | "fill" | "attention" | "active" | "success" | "danger";

const TONE: Record<TagTone, string> = {
  outline: "border-border text-muted-foreground",
  fill: "border-transparent bg-secondary text-secondary-foreground",
  attention: "border-transparent bg-attention-bg text-attention",
  active: "border-transparent bg-active-bg text-active",
  success: "border-transparent bg-success-bg text-success",
  danger: "border-transparent bg-danger-bg text-danger",
};

/**
 * A small square-cornered label beside a name: a version, a source, an attempt, a count. Run and node
 * statuses use StatusBadge instead. `mono` for versions, keys and paths.
 */
export function Tag({ tone = "outline", mono, className, ...props }: ComponentProps<"span"> & { tone?: TagTone; mono?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] border px-[7px] text-[11px] font-medium whitespace-nowrap [&_svg]:size-[11px]",
        TONE[tone],
        mono && "font-mono",
        className,
      )}
      {...props}
    />
  );
}
