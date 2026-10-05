import Link from "next/link";
import { ListOrderedIcon, MilestoneIcon } from "lucide-react";
import { planPath } from "@/lib/paths";
import { dueText, milestoneLine, undatedText } from "@/lib/plan/milestone-text";
import { cn } from "@/lib/utils";
import type { OverviewMilestone } from "@/server/overview";
import { FeatureProgress } from "./features";
import { OverviewList, OverviewSection } from "./overview-section";

const TONE = { late: "text-danger", ok: "text-success", plain: "text-foreground/80" };

/** The plan mode's line and what it leaves out: the skipped tasks in Flow mode, the undated ones on the Timeline. */
function Line({ milestone }: { milestone: OverviewMilestone }) {
  const line = milestoneLine(milestone.progress);
  const flow = milestone.progress.flow !== undefined;
  const notes = flow ? milestone.skipped.map((s) => `#${s.issue} skipped: ${s.why}`) : [undatedText(milestone.progress.timeline?.undated ?? [])].filter((n) => n !== undefined);
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
      <span className={cn("inline-flex items-center gap-1 font-medium whitespace-nowrap", TONE[line.tone])}>
        {flow && <ListOrderedIcon aria-hidden className="size-3" />}
        {line.text}
      </span>
      {notes.map((note) => (
        <span key={note} className="inline-flex items-center gap-2.5">
          <span aria-hidden className="size-[3px] rounded-full bg-muted-foreground/60" />
          {note}
        </span>
      ))}
    </p>
  );
}

/**
 * The repository's open milestones by due date, above Features in progress: the days left to each due date, its
 * tasks by status in the bar the epics use, and the plan mode's line. Flow mode says where the milestone ends in the
 * order and gives no forecast. A title opens the plan filtered to its milestone. Nothing shows without an open one.
 */
export function Milestones({ milestones, projectId, today }: { milestones: OverviewMilestone[]; projectId: string; today: string }) {
  if (milestones.length === 0) return null;
  return (
    <OverviewSection id="milestones" title="Milestones" count={milestones.length} more={{ href: planPath(projectId), label: "Open the plan" }}>
      <OverviewList>
        {milestones.map((m) => (
          <li key={m.number} aria-labelledby={`milestone-${m.number}`} className="flex flex-col gap-2.5 px-4 pt-3.5 pb-3">
            <div className="flex min-w-0 items-center gap-2">
              <MilestoneIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <Link
                id={`milestone-${m.number}`}
                href={`${planPath(projectId)}?milestone=${m.number}`}
                title={`Open the plan filtered to ${m.title}`}
                className="min-w-0 truncate text-sm font-semibold hover:underline hover:underline-offset-3"
              >
                {m.title}
              </Link>
              <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{dueText(m, today)}</span>
            </div>
            {m.progress.total > 0 && <FeatureProgress progress={m.progress} />}
            <Line milestone={m} />
          </li>
        ))}
      </OverviewList>
    </OverviewSection>
  );
}
