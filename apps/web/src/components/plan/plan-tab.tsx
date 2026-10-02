import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import type { PlanColumn, PlanView } from "@/server/plan";
import type { PlanSignals } from "@/server/plan-signals";
import type { GitHubActivity } from "@/server/plan-activity";
import { IssuePages } from "@/components/issues/issue-pages";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { formatAgo } from "@/lib/format";
import { planPath } from "@/lib/paths";
import { filterPlan, isFiltered, type PlanFilters as Filters } from "@/lib/plan/filters";
import { deriveSpans } from "@/lib/plan/schedule";
import type { Zoom } from "@/lib/plan/timeline-scale";
import type { PlanViewName } from "@/lib/project-tab";
import type { StartRunContext } from "./plan-actions";
import { PlanBoard } from "./plan-board";
import { PlanEmpty } from "./plan-empty";
import { PlanFilters } from "./plan-filters";
import { PlanRefresher } from "./plan-refresher";
import { PlanTimeline } from "./plan-timeline";
import { PlanTree } from "./plan-tree";

const IDLE = new Set([undefined, "cancelled"]);

/** Filters that leave nothing to show, with the way back to the whole plan. */
function NoMatches({ projectId, view }: { projectId: string; view: PlanViewName }) {
  return (
    <Empty className="rounded-lg border py-10">
      <EmptyHeader>
        <EmptyTitle>{view === "timeline" ? "No items match these filters" : "No tasks match these filters"}</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" asChild>
          <Link href={planPath(projectId, { view })} replace scroll={false}>
            Clear filters
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

type PlanTabProps = {
  project: { id: string; name: string; repoOwner: string; repoName: string };
  plan: PlanView;
  view: PlanViewName;
  /** The timeline's zoom from ?zoom=; undefined lets the timeline pick one. */
  zoom?: Zoom | undefined;
  filters: Filters;
  signals: PlanSignals;
  start: StartRunContext;
  /** When the page read GitHub, in epoch milliseconds. */
  readAt: number;
  activity: GitHubActivity | null;
};

/** The chosen view of the plan narrowed by the filters, or what to say when there is nothing to show. */
function PlanBody({ project, plan, view, zoom, filters, signals, start, readAt }: Omit<PlanTabProps, "activity">) {
  if (plan.epics.length === 0 && plan.unparented.length === 0 && plan.unplanned.length === 0) {
    return <PlanEmpty reason="empty" project={{ id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }} />;
  }
  const narrowed = filterPlan(plan, filters, signals.needsYou);
  const shared = { projectId: project.id, repoUrl: `https://github.com/${project.repoOwner}/${project.repoName}`, needsYou: signals.needsYou, skipped: signals.skipped, ...start };
  // The board shows its columns whatever the filters leave; the timeline has no place for unplanned issues.
  const shown = narrowed.epics.length + narrowed.unparented.length + (view === "timeline" ? 0 : narrowed.unplanned.length);
  if (view !== "board" && shown === 0 && isFiltered(filters)) return <NoMatches projectId={project.id} view={view} />;
  switch (view) {
    case "board":
      return <PlanBoard {...shared} project={plan.project} board={narrowed.board} epics={plan.epics} now={readAt} />;
    case "timeline":
      return (
        <PlanTimeline
          {...shared}
          project={plan.project}
          epics={narrowed.epics}
          unparented={narrowed.unparented}
          timeline={plan.timeline ?? deriveSpans([], [], new Date(readAt))}
          zoom={zoom}
          filters={filters}
          readAt={readAt}
        />
      );
    default:
      return <PlanTree {...shared} epics={narrowed.epics} unparented={narrowed.unparented} unplanned={narrowed.unplanned} hidden={narrowed.hidden} />;
  }
}

/**
 * The Plan page under its header: the toolbar with the view and the filters, the tree, the board or
 * the timeline narrowed by them, and at the bottom the latest change GitHub reported with the refresh line.
 */
export function PlanTab({ activity, ...props }: PlanTabProps) {
  const { project, plan, view, filters, readAt } = props;
  const counts = Object.fromEntries(Object.entries(plan.board).map(([c, tasks]) => [c, tasks.length])) as Record<PlanColumn, number>;
  const ready = plan.board.Ready.filter((t) => t.state === "open" && IDLE.has(t.run?.status)).length;

  return (
    <div className="flex flex-col gap-4">
      <PlanFilters
        projectId={project.id}
        view={view}
        filters={filters}
        epics={plan.epics}
        counts={counts}
        unplanned={plan.unplanned.length}
        aside={
          <Button variant="link" size="sm" className="px-0" asChild>
            <Link href={`/projects/${project.id}/issues`}>
              {ready === 1 ? "1 Ready task in the backlog" : `${ready} Ready tasks in the backlog`}
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        }
      />
      <IssuePages projectId={project.id}>
        <PlanBody {...props} />
      </IssuePages>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{activity && `Last from GitHub: ${activity.summary}, ${formatAgo(activity.receivedAt, new Date(readAt))}`}</span>
        <PlanRefresher readAt={readAt} />
      </div>
    </div>
  );
}
