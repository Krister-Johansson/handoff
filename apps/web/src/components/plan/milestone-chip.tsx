import type { ComponentProps } from "react";
import { MilestoneIcon } from "lucide-react";
import type { ItemMilestone } from "@/lib/plan/milestones";
import { cn } from "@/lib/utils";

/** A small outlined chip with the milestone icon: an item's milestone, or "Last of 0.9" in the Flow. Dashed when inherited. */
export function MilestoneTag({ dashed, className, children, ...props }: ComponentProps<"span"> & { dashed?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] border border-border px-1.5 text-[10.5px] font-medium whitespace-nowrap text-foreground/80 [&_svg]:size-2.5 [&_svg]:text-muted-foreground",
        dashed && "border-dashed text-muted-foreground",
        className,
      )}
      {...props}
    >
      <MilestoneIcon aria-hidden />
      {children}
    </span>
  );
}

/** Where an item's milestone comes from, in words: "set on this issue", or "from epic #12". */
export const milestoneSource = (m: ItemMilestone) => (m.inherited ? `from ${m.inherited.kind} #${m.inherited.issue}` : "set on this issue");

/** An item's milestone as a chip: solid when the item sets it, dashed and named "from epic #12" when it inherits it. */
export function MilestoneChip({ milestone, className }: { milestone: ItemMilestone; className?: string }) {
  return (
    <MilestoneTag dashed={milestone.inherited !== undefined} title={`Milestone ${milestone.title}, ${milestoneSource(milestone)}`} className={className}>
      {milestone.title}
      {milestone.inherited && <span className="font-normal">{milestoneSource(milestone)}</span>}
    </MilestoneTag>
  );
}
