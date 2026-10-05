import Link from "next/link";
import { CircleCheckIcon, CircleDotIcon, GitMergeIcon, GitPullRequestDraftIcon, GitPullRequestIcon, ListTreeIcon, MilestoneIcon } from "lucide-react";
import { KindBadge, ProgressBar, StatusPill } from "@/components/plan/plan-status";
import { IssueTitle } from "@/components/plan/plan-task-parts";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fromToday } from "@/lib/issue-dates";
import { planPath } from "@/lib/paths";
import { COLUMN_TONE, hasActiveRun, taskColumn } from "@/lib/plan/task";
import { shortDay } from "@/lib/plan/timeline-scale";
import type { Timeline } from "@/lib/plan/schedule";
import { cn } from "@/lib/utils";
import type { FoundIssue, IssueLink, IssuePull, PlannedEpic, PlannedStory, PlannedTask, PlanParent, Unplanned } from "@/server/issue-page";
import type { PlanColumn, PlanProgress } from "@/server/plan";
import { MilestoneNote } from "./milestone-note";
import { MilestonePicker } from "./milestone-picker";
import { MiniTimeline } from "./mini-timeline";
import { Quiet, RailSection } from "./issue-section";

const andList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** An issue that blocks this one or that this one blocks: GitHub's open or completed mark, its title, and its Status in the plan. */
function LinkRow({ link }: { link: IssueLink }) {
  const closed = link.state === "closed";
  return (
    <li className={cn("flex min-w-0 items-center gap-2", closed && "text-muted-foreground")}>
      {closed ? <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-repaired" /> : <CircleDotIcon aria-hidden className="size-3.5 shrink-0 text-success" />}
      <IssueTitle item={link} className="flex-1" />
      {!closed && link.status && <StatusPill column={link.status} />}
    </li>
  );
}

function Links({ links, empty }: { links: IssueLink[]; empty: string }) {
  if (links.length === 0) return <Quiet>{empty}</Quiet>;
  return (
    <ul className="flex flex-col gap-2">
      {links.map((link) => (
        <LinkRow key={link.number} link={link} />
      ))}
    </ul>
  );
}

function BlockedBy({ page }: { page: FoundIssue }) {
  const open = page.blockedBy.filter((b) => b.state === "open").length;
  return (
    <RailSection title={page.blockedBy.length ? `Blocked by ${page.blockedBy.length}` : "Blocked by"} aside={page.blockedBy.length > 0 && `${open} open`}>
      <Links links={page.blockedBy} empty={`Nothing blocks #${page.issue.number}.`} />
    </RailSection>
  );
}

function Blocks({ page }: { page: FoundIssue }) {
  return (
    <RailSection title="Blocks">
      <Links links={page.blocking} empty={`No issue waits for #${page.issue.number}.`} />
    </RailSection>
  );
}

const PR_ICON = { open: GitPullRequestIcon, draft: GitPullRequestDraftIcon, merged: GitMergeIcon, closed: GitPullRequestIcon, unknown: GitPullRequestIcon };
const PR_TONE = { open: "text-success", draft: "text-muted-foreground", merged: "text-repaired", closed: "text-danger", unknown: "text-muted-foreground" };

/** What a pull request's checks and review say, in a few words. */
function prFacts(pr: IssuePull): string {
  const facts = [];
  if (pr.checks) {
    const { passed, failed, pending } = pr.checks;
    if (failed) facts.push(`${failed} check${failed === 1 ? "" : "s"} failed`);
    if (pending) facts.push(`${pending} running`);
    if (!failed && !pending && passed) facts.push(`${passed} check${passed === 1 ? "" : "s"} passed`);
  }
  if (pr.reviewDecision === "APPROVED") facts.push("approved");
  if (pr.reviewDecision === "CHANGES_REQUESTED") facts.push("changes requested");
  return facts.join(", ");
}

function Pulls({ pulls, title, empty }: { pulls: IssuePull[]; title: string; empty: string }) {
  return (
    <RailSection title={title}>
      {pulls.length === 0 ? (
        <Quiet>{empty}</Quiet>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {pulls.map((pr) => {
            const state = pr.state === "open" && pr.draft ? "draft" : pr.state;
            const Icon = PR_ICON[state];
            const facts = prFacts(pr);
            return (
              <li key={pr.number} className="flex min-w-0 items-start gap-2">
                <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", PR_TONE[state])} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <a href={pr.url} className="truncate text-[13px] hover:underline hover:underline-offset-3" title={pr.title ?? undefined}>
                    <span className="font-mono text-xs text-muted-foreground">#{pr.number}</span> {pr.title ?? "Pull request"}
                  </a>
                  <span className="text-xs text-muted-foreground">{[state === "unknown" ? "GitHub did not say" : state, facts].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </RailSection>
  );
}

function PartOf({ parents }: { parents: PlanParent[] }) {
  return (
    <RailSection title="Part of">
      {parents.length === 0 ? (
        <Quiet>No story or epic of the plan holds it.</Quiet>
      ) : (
        <ul className="flex flex-col gap-3">
          {parents.map((p) => (
            <li key={p.number} className="flex min-w-0 flex-col gap-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <KindBadge kind={p.kind} />
                <IssueTitle item={p} className="flex-1" />
              </span>
              <ProgressBar progress={p.progress} className="[&>span:first-child]:w-auto [&>span:first-child]:flex-1" />
            </li>
          ))}
        </ul>
      )}
    </RailSection>
  );
}

/** Why a task's moves are missing, when they are. */
function whyNoMove(place: PlannedTask, blockedBy: number[]): string | undefined {
  const task = place.item;
  const column = taskColumn(task);
  if (task.run && hasActiveRun(task)) {
    const keeps = column === "Running" ? " A running task keeps its status." : column === "In review" ? " A task in review keeps its status." : "";
    return `Back to Shaping and Start run come back when run ${task.run.id.slice(0, 8)} ends.${keeps}`;
  }
  if (column === "Ready" && blockedBy.length) return `Start run comes back when ${andList(blockedBy.map((n) => `#${n}`))} ${blockedBy.length === 1 ? "closes" : "close"}.`;
  if (column === "Shaping") return "Move to Ready lets it into the backlog, where a run can start on it.";
  return undefined;
}

function InThePlan({ place }: { place: PlannedTask }) {
  const why = whyNoMove(place, place.item.blockedBy);
  return (
    <RailSection title="In the plan">
      <span className="flex flex-wrap items-center gap-2 text-[13px]">
        <StatusPill column={taskColumn(place.item)} spinning={taskColumn(place.item) === "Running" && hasActiveRun(place.item)} />
        <a href={place.project.url} className="text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-3">
          {place.project.title}
        </a>
      </span>
      {why && <p className="text-[13px] text-muted-foreground">{why}</p>}
    </RailSection>
  );
}

function NotInThePlan({ place, number }: { place: Unplanned; number: number }) {
  const text = place.project
    ? `#${number} is not an item of the GitHub Project ${place.project.title}. Plan it adds it as a task in Shaping, under a story if you pick one.`
    : (place.error ?? "This project has no plan on GitHub yet.");
  return (
    <RailSection title="In the plan">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <ListTreeIcon aria-hidden className="size-4" />
        </span>
        <span className="flex flex-col gap-0.5 text-[13px]">
          <span className="font-medium">Not in the plan</span>
          <span className="text-muted-foreground">{text}</span>
        </span>
      </div>
    </RailSection>
  );
}

const LEGEND: PlanColumn[] = ["Done", "In review", "Running", "Ready", "Shaping"];

/** A story's or an epic's progress at full width: done of total, the bar, the count per status, and GitHub's own count. */
function Progress({ progress, every }: { progress: PlanProgress; every?: boolean }) {
  const shown = LEGEND.filter((c) => every || progress.byStatus[c] > 0);
  const { total, completed } = progress.subIssues;
  return (
    <RailSection title="Progress">
      <p className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {progress.done} of {progress.total}
        </span>
        <span className="text-[13px] text-muted-foreground">tasks done</span>
      </p>
      <span role="img" aria-label={shown.map((c) => `${progress.byStatus[c]} ${c}`).join(", ") || "No tasks"} className="flex h-2 overflow-hidden rounded-full bg-muted">
        {LEGEND.filter((c) => progress.byStatus[c] > 0).map((c) => (
          <span key={c} className={cn("h-full", COLUMN_TONE[c].dot)} style={{ width: `${(progress.byStatus[c] / progress.total) * 100}%` }} />
        ))}
      </span>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {shown.map((c) => (
          <li key={c} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-1.5 rounded-full", COLUMN_TONE[c].dot)} />
            <span className="font-semibold text-foreground tabular-nums">{progress.byStatus[c]}</span> {c}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        GitHub counts {total} sub-issue{total === 1 ? "" : "s"}, {completed === 0 ? "none" : completed === total ? "all" : completed} closed.
      </p>
    </RailSection>
  );
}

function Dates({ place, today }: { place: PlannedEpic; today: string }) {
  const { start, target } = place.item;
  const stories = place.item.stories;
  const finished = stories.filter((s) => s.progress.total > 0 && s.progress.done === s.progress.total).length;
  return (
    <RailSection title="Dates">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-muted-foreground">Start</dt>
        <dd>{start ? shortDay(start) : "Not set"}</dd>
        <dt className="text-muted-foreground">Target</dt>
        <dd>{target ? `${shortDay(target)}, ${fromToday(target, today)}` : "Not set"}</dd>
        <dt className="text-muted-foreground">Stories</dt>
        <dd>{finished === 0 ? "None has every task done" : `${finished} of ${stories.length} have every task done`}</dd>
      </dl>
    </RailSection>
  );
}

function Waiting({ place }: { place: PlannedEpic }) {
  const { needsYou, waitingTasks, blockers } = place.waiting;
  const total = place.item.progress.total;
  return (
    <RailSection title="Waiting">
      {needsYou.length === 0 && blockers.length === 0 && <Quiet>Nothing waits: no task needs you or waits on an open blocker.</Quiet>}
      {needsYou.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {needsYou.map((n) => (
            <span key={n} className="inline-flex h-[22px] items-center rounded-full bg-attention-bg px-2 text-xs font-medium text-attention">
              #{n} needs you
            </span>
          ))}
        </span>
      )}
      {blockers.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            {waitingTasks} of its {total} tasks wait on an open blocker. Closing these frees the most:
          </p>
          <ul className="flex flex-col gap-2">
            {blockers.map((b) => (
              <li key={b.number} className="flex min-w-0 items-center gap-2">
                <CircleDotIcon aria-hidden className="size-3.5 shrink-0 text-success" />
                <IssueTitle item={b} className="flex-1" />
                <span className="shrink-0 text-xs text-muted-foreground">blocks {b.blocks}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </RailSection>
  );
}

function StoryTimeline({ place, timeline, projectId, epic }: { place: PlannedStory; timeline: Timeline; projectId: string; epic: number | undefined }) {
  return (
    <RailSection
      title="Timeline"
      aside={
        <Link href={planPath(projectId, { view: "timeline", ...(epic ? { epic } : {}) })} className="normal-case tracking-normal hover:text-foreground hover:underline hover:underline-offset-3">
          Open the timeline
        </Link>
      }
    >
      <MiniTimeline timeline={timeline} rows={[place.item, ...place.item.tasks]} compact />
    </RailSection>
  );
}

/** The Milestone section of an issue of the plan: its milestone, own or inherited, and the picker that sets it. */
function MilestoneSection({ page, place, projectId }: { page: FoundIssue; place: PlannedTask | PlannedStory | PlannedEpic; projectId: string }) {
  return (
    <RailSection title="Milestone">
      <MilestonePicker projectId={projectId} issue={page.issue.number} kind={place.kind} own={page.issue.milestone} inherited={place.item.milestone} milestones={page.milestones} />
    </RailSection>
  );
}

/** An issue outside the plan in a milestone: the milestone without a picker, which sets milestones on the plan's items only. */
function OutsideMilestone({ page }: { page: FoundIssue }) {
  const { milestone, number } = page.issue;
  if (!milestone) return null;
  return (
    <RailSection title="Milestone">
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
        <MilestoneIcon aria-hidden className="size-3.5 text-muted-foreground" />
        {milestone.title}
      </span>
      <MilestoneNote milestone={page.milestones.find((m) => m.number === milestone.number)} then={`Plan #${number} to change its milestone here.`} />
    </RailSection>
  );
}

/** The rail's sections for an issue of the plan, by kind. A Flow project's epic has no Dates, since it plans an order without dates. */
function plannedSections(page: FoundIssue, place: PlannedTask | PlannedStory | PlannedEpic, projectId: string, today: string) {
  const milestone = <MilestoneSection key="milestone" page={page} place={place} projectId={projectId} />;
  if (place.kind === "task") {
    return [
      <InThePlan key="plan" place={place} />,
      milestone,
      <PartOf key="part" parents={place.parents} />,
      <BlockedBy key="blocked" page={page} />,
      <Blocks key="blocks" page={page} />,
      <Pulls key="pulls" pulls={page.pulls} title="Pull request" empty="None yet. The run's pull request shows here when it opens." />,
    ];
  }
  if (place.kind === "story") {
    return [
      <Progress key="progress" progress={place.item.progress} />,
      milestone,
      <PartOf key="part" parents={place.parents} />,
      ...(place.timeline ? [<StoryTimeline key="timeline" place={place} timeline={place.timeline} projectId={projectId} epic={place.parents[0]?.number} />] : []),
      <Pulls key="pulls" pulls={page.pulls} title="Pull requests" empty="None of its tasks has a pull request yet." />,
    ];
  }
  return [
    <Progress key="progress" progress={place.item.progress} every />,
    milestone,
    ...(page.planMode === "timeline" ? [<Dates key="dates" place={place} today={today} />] : []),
    <Waiting key="waiting" place={place} />,
  ];
}

/** The right rail: where the issue sits, by kind. Below 768 px it sits between the first section and the description. */
export function IssueRail({ page, projectId, today }: { page: FoundIssue; projectId: string; today: string }) {
  const { place } = page;
  const sections = place.planned
    ? plannedSections(page, place, projectId, today)
    : [
        <NotInThePlan key="plan" place={place} number={page.issue.number} />,
        ...(page.issue.milestone ? [<OutsideMilestone key="milestone" page={page} />] : []),
        <BlockedBy key="blocked" page={page} />,
        ...(page.blocking.length ? [<Blocks key="blocks" page={page} />] : []),
        <Pulls key="pulls" pulls={page.pulls} title="Pull request" empty="None yet." />,
      ];
  return (
    <aside aria-label={`Where #${page.issue.number} sits`} className="min-w-0 [grid-area:rail] lg:self-start">
      <Card className="gap-0 py-0">
        {sections.flatMap((section, i) => (i === 0 ? [section] : [<Separator key={`sep-${String(section.key)}`} />, section]))}
      </Card>
    </aside>
  );
}
