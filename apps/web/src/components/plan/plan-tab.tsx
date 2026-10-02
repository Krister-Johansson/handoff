import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import type { PlanColumn, PlanView } from "@/server/plan";
import type { PlanSignals } from "@/server/plan-signals";
import type { GitHubActivity } from "@/server/plan-activity";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { formatAgo } from "@/lib/format";
import { planPath } from "@/lib/paths";
import { filterPlan, isFiltered, type PlanFilters as Filters } from "@/lib/plan/filters";
import type { PlanViewName } from "@/lib/project-tab";
import type { StartRunContext } from "./plan-actions";
import { PlanBoard } from "./plan-board";
import { PlanEmpty } from "./plan-empty";
import { PlanFilters } from "./plan-filters";
import { PlanRefresher } from "./plan-refresher";
import { PlanTree } from "./plan-tree";

const IDLE = new Set([undefined, "cancelled"]);

/**
 * The Plan page under its header: the toolbar with the view and the filters, the tree or the board
 * narrowed by them, and at the bottom the latest change GitHub reported with the refresh line.
 */
export function PlanTab({
  project,
  plan,
  view,
  filters,
  signals,
  start,
  readAt,
  activity,
}: {
  project: { id: string; name: string; repoOwner: string; repoName: string };
  plan: PlanView;
  view: PlanViewName;
  filters: Filters;
  signals: PlanSignals;
  start: StartRunContext;
  /** When the page read GitHub, in epoch milliseconds. */
  readAt: number;
  activity: GitHubActivity | null;
}) {
  const repoUrl = `https://github.com/${project.repoOwner}/${project.repoName}`;
  const counts = Object.fromEntries(Object.entries(plan.board).map(([c, tasks]) => [c, tasks.length])) as Record<PlanColumn, number>;
  const ready = plan.board.Ready.filter((t) => t.state === "open" && IDLE.has(t.run?.status)).length;
  const empty = plan.epics.length === 0 && plan.unparented.length === 0 && plan.unplanned.length === 0;
  const narrowed = filterPlan(plan, filters, signals.needsYou);
  const nothingMatches = narrowed.epics.length === 0 && narrowed.unparented.length === 0 && narrowed.unplanned.length === 0;
  const shared = { projectId: project.id, repoUrl, needsYou: signals.needsYou, skipped: signals.skipped, ...start };

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
            <Link href={`/projects/${project.id}?tab=issues`}>
              {ready === 1 ? "1 Ready task in the backlog" : `${ready} Ready tasks in the backlog`}
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        }
      />
      {empty ? (
        <PlanEmpty reason="empty" project={{ id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }} />
      ) : view === "board" ? (
        <PlanBoard {...shared} project={plan.project} board={narrowed.board} epics={plan.epics} now={readAt} />
      ) : nothingMatches && isFiltered(filters) ? (
        <Empty className="rounded-lg border py-10">
          <EmptyHeader>
            <EmptyTitle>No tasks match these filters</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" asChild>
              <Link href={planPath(project.id, { view })} replace scroll={false}>
                Clear filters
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <PlanTree {...shared} epics={narrowed.epics} unparented={narrowed.unparented} unplanned={narrowed.unplanned} hidden={narrowed.hidden} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{activity && `Last from GitHub: ${activity.summary}, ${formatAgo(activity.receivedAt, new Date(readAt))}`}</span>
        <PlanRefresher readAt={readAt} />
      </div>
    </div>
  );
}
