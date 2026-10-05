"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CircleCheckIcon, CircleDashedIcon, ExternalLinkIcon, ListOrderedIcon, MilestoneIcon, TriangleAlertIcon } from "lucide-react";
import { Tag } from "@/components/tag";
import { planPath } from "@/lib/paths";
import type { PlanFilters } from "@/lib/plan/filters";
import { lowerFirst } from "@/lib/plan/flow-text";
import { dueText, endsText, flowEndText, skippedText, undatedText, type EndTone } from "@/lib/plan/milestone-text";
import type { MilestoneTasks, PlanMilestone } from "@/lib/plan/milestones";
import type { PlanModeName, PlanViewName } from "@/lib/project-tab";
import { cn } from "@/lib/utils";
import { StatusSegments } from "./plan-status";

const CARD =
  "flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-3.5 pt-[11px] pb-3 text-left text-foreground hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:w-[272px] max-sm:shrink-0 aria-pressed:border-foreground/70 aria-pressed:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_70%,transparent)]";

const TONE: Record<EndTone | "flow", string> = {
  late: "text-danger",
  early: "text-success",
  neutral: "text-muted-foreground",
  flow: "text-foreground/80",
};

/** One judgement on a card: when the Timeline ends the milestone, or where it ends in the Flow's order. */
function Verdict({ tone, icon, children }: { tone: EndTone | "flow"; icon: ReactNode; children: string }) {
  return (
    <span data-tone={tone} className={cn("inline-flex items-center gap-1 font-medium whitespace-nowrap [&_svg]:size-3", TONE[tone])}>
      {icon}
      {children}
    </span>
  );
}

/** A milestone's title row: its icon, its title, and on the right the due date or the open tasks. */
function CardHead({ icon, title, right }: { icon: ReactNode; title: string; right: string }) {
  return (
    <span className="flex min-w-0 items-center gap-[7px] [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
      {icon}
      <span className="truncate text-[13.5px] font-semibold">{title}</span>
      <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{right}</span>
    </span>
  );
}

/** What a milestone's card says under its bar, and the same words for a screen reader. */
function cardWords(m: PlanMilestone) {
  const { progress } = m;
  const ends = progress.timeline && endsText(progress.timeline);
  const undated = progress.timeline && undatedText(progress.timeline.undated);
  const flowEnd = progress.flow && flowEndText(progress.flow);
  const skipped = progress.flow && skippedText(progress.flow);
  const done = progress.total ? `${progress.done} of ${progress.total} tasks done` : "No tasks yet";
  const label = [`Milestone ${m.title}`, lowerFirst(dueText(m)), lowerFirst(done), ends && lowerFirst(ends.text), undated?.text, flowEnd && lowerFirst(flowEnd), skipped].filter(Boolean).join(", ");
  return { ends, undated, flowEnd, skipped, label };
}

/** An open milestone: its title and due date, its tasks by status, how many are done, and the plan mode's judgement. */
function MilestoneCard({ milestone: m, on, onClick }: { milestone: PlanMilestone; on: boolean; onClick: () => void }) {
  const { progress } = m;
  const { ends, undated, flowEnd, skipped, label } = cardWords(m);
  return (
    <button type="button" aria-pressed={on} aria-label={on ? `${label}. Showing only this milestone` : label} onClick={onClick} className={CARD}>
      <CardHead icon={<MilestoneIcon aria-hidden />} title={m.title} right={dueText(m)} />
      <StatusSegments byStatus={progress.byStatus} total={progress.total} className="w-full" />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted-foreground">
        {progress.total ? (
          <span>
            <b className="font-semibold text-foreground tabular-nums">{progress.done}</b> of {progress.total} tasks done
          </span>
        ) : (
          <span>No tasks yet</span>
        )}
        {ends && (
          <Verdict tone={ends.tone} icon={ends.tone === "late" ? <TriangleAlertIcon aria-hidden /> : ends.tone === "early" ? <CircleCheckIcon aria-hidden /> : undefined}>
            {ends.text}
          </Verdict>
        )}
        {undated && <span title={undated.all}>{undated.text}</span>}
        {flowEnd && (
          <Verdict tone="flow" icon={<ListOrderedIcon aria-hidden />}>
            {flowEnd}
          </Verdict>
        )}
        {skipped && <span>{skipped}</span>}
      </span>
    </button>
  );
}

/** The tasks in no milestone, own or inherited, as a dashed card. */
function NoMilestoneCard({ open, on, onClick }: { open: number; on: boolean; onClick: () => void }) {
  const label = `Tasks in no milestone, ${open} open`;
  return (
    <button type="button" aria-pressed={on} aria-label={on ? `${label}. Showing only these tasks` : label} onClick={onClick} className={cn(CARD, "border-dashed bg-transparent")}>
      <CardHead icon={<CircleDashedIcon aria-hidden />} title="No milestone" right={open === 1 ? "1 open task" : `${open} open tasks`} />
      <span className="text-xs text-muted-foreground">Tasks whose epic, story and own issue have no milestone.</span>
    </button>
  );
}

type Props = {
  projectId: string;
  /** owner/name, for the link to the repository's milestones on GitHub. */
  repo: string;
  view: PlanViewName;
  mode: PlanModeName;
  /** The filters with the search as it stands, so a card keeps them. */
  filters: PlanFilters;
  /** The repository's milestones, open and closed, as loadPlan judged them. */
  milestones: PlanMilestone[] | undefined;
  /** The tasks in no milestone. */
  none: MilestoneTasks | undefined;
};

/**
 * The open milestones above the Plan page's toolbar, in every view, with a card for the open tasks in no milestone.
 * A card click shows only its milestone through ?milestone=, and a second click shows everything again. Closed
 * milestones are left to the Milestone filter. Under 640 px the cards scroll sideways.
 */
export function MilestoneStrip({ projectId, repo, view, mode, filters, milestones, none }: Props) {
  const router = useRouter();
  const open = (milestones ?? []).filter((m) => m.state === "open");
  if (open.length === 0) return null;
  const pick = (milestone: number | "none") =>
    router.replace(planPath(projectId, { view, ...filters, milestone: filters.milestone === milestone ? undefined : milestone }), { scroll: false });
  const openNone = none ? none.total - none.done : 0;
  return (
    <section aria-label="Milestones" className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 text-[11px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
        Milestones
        <Tag tone="fill" className="h-4 min-w-4 justify-center px-1 text-[10px] tracking-normal">
          {open.length}
        </Tag>
        {mode === "flow" && <span className="truncate font-normal tracking-normal text-muted-foreground/80 normal-case max-sm:hidden">Flow has no dates, so each milestone shows where it ends in the order.</span>}
        <a
          href={`https://github.com/${repo}/milestones`}
          title={`Open the milestones of ${repo} on GitHub`}
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-normal tracking-normal text-muted-foreground normal-case hover:text-foreground [&_svg]:size-3"
        >
          Milestones on GitHub
          <ExternalLinkIcon aria-hidden />
        </a>
      </div>
      <div className="flex gap-2.5 max-sm:-mx-6 max-sm:overflow-x-auto max-sm:px-6 max-sm:pb-1 sm:grid sm:grid-cols-3">
        {open.map((m) => (
          <MilestoneCard key={m.number} milestone={m} on={filters.milestone === m.number} onClick={() => pick(m.number)} />
        ))}
        {openNone > 0 && <NoMilestoneCard open={openNone} on={filters.milestone === "none"} onClick={() => pick("none")} />}
      </div>
    </section>
  );
}
