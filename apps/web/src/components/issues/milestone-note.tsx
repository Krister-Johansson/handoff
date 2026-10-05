import { dueShort, milestoneLine } from "@/lib/plan/milestone-text";
import type { PlanMilestone } from "@/lib/plan/milestones";

/**
 * The line under a milestone in the issue rail: "Due Oct 20. 2 of 11 tasks done. Ends after Next 6." The last part
 * follows the plan mode: where it ends in the Flow's order, or when it ends on the Timeline against its due date.
 * `then` adds a sentence of the caller's.
 */
export function MilestoneNote({ milestone, then }: { milestone: PlanMilestone | undefined; then?: string }) {
  if (!milestone) return then ? <p className="text-[13px] text-muted-foreground">{then}</p> : null;
  const { progress } = milestone;
  const parts =
    milestone.state === "closed"
      ? ["Closed on GitHub", `${progress.done} of ${progress.total} tasks done`]
      : [dueShort(milestone) ?? "No due date", ...(progress.total > 0 ? [`${progress.done} of ${progress.total} tasks done`] : []), milestoneLine(progress).text];
  return <p className="text-[13px] text-muted-foreground">{[...parts.map((p) => `${p}.`), ...(then ? [then] : [])].join(" ")}</p>;
}
