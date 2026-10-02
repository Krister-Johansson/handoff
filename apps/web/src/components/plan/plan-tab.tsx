"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { PlanColumn, PlanView } from "@/server/plan";
import type { PlanSignals } from "@/server/plan-signals";
import type { GitHubActivity } from "@/server/plan-activity";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { formatAgo } from "@/lib/format";
import { planPath } from "@/lib/paths";
import { filterPlan, isFiltered, type NarrowedPlan, type PlanFilters as Filters } from "@/lib/plan/filters";
import { deriveSpans } from "@/lib/plan/schedule";
import type { Zoom } from "@/lib/plan/timeline-scale";
import type { PlanViewName } from "@/lib/project-tab";
import type { StartRunContext } from "./plan-actions";
import { PlanBoard } from "./plan-board";
import { PlanEmpty } from "./plan-empty";
import { FilterChips, PlanFilters } from "./plan-filters";
import { PlanRefresher } from "./plan-refresher";
import { PlanTimeline } from "./plan-timeline";
import { PlanToolbar } from "./plan-toolbar";
import { PlanTree } from "./plan-tree";

/** Filters that leave nothing to show, with the way back to the whole plan. */
function NoMatches({ projectId, view, q }: { projectId: string; view: PlanViewName; q: string }) {
  return (
    <Empty className="rounded-lg border py-10">
      <EmptyHeader>
        <EmptyTitle>{view === "timeline" ? "No items match these filters" : "No tasks match these filters"}</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" asChild>
          <Link href={planPath(projectId, { view, q })} replace scroll={false}>
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
  /** The login of the token handoff uses: Me in the Assignee filter. Undefined with a GitHub App, which acts as no person. */
  me?: string | undefined;
};

type BodyProps = Omit<PlanTabProps, "activity" | "me" | "filters"> & { filters: Filters; narrowed: NarrowedPlan };

/** The chosen view of the plan narrowed by the filters, or what to say when there is nothing to show. */
function PlanBody({ project, plan, view, zoom, filters, narrowed, signals, start, readAt }: BodyProps) {
  if (plan.epics.length === 0 && plan.unparented.length === 0 && plan.unplanned.length === 0) {
    return <PlanEmpty reason="empty" project={{ id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }} />;
  }
  const shared = { projectId: project.id, repoUrl: `https://github.com/${project.repoOwner}/${project.repoName}`, needsYou: signals.needsYou, skipped: signals.skipped, ...start };
  // The board shows its columns whatever the filters leave; the timeline has no place for unplanned issues.
  const shown = narrowed.epics.length + narrowed.unparented.length + (view === "timeline" ? 0 : narrowed.unplanned.length);
  if (view !== "board" && shown === 0 && isFiltered(filters)) return <NoMatches projectId={project.id} view={view} q={filters.q} />;
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

/** Everyone assigned to a task in the plan other than me, by login. */
function peopleOf(plan: PlanView, me: string | undefined): string[] {
  const logins = new Set(Object.values(plan.board).flatMap((tasks) => tasks.flatMap((t) => t.assignees)));
  return [...logins].filter((l) => l.toLowerCase() !== me?.toLowerCase()).toSorted((a, b) => a.localeCompare(b));
}

/**
 * The Plan page under its header: the toolbar with the view, the search and the filters, the tree, the
 * board or the timeline narrowed by them, and at the bottom the latest change GitHub reported with the
 * refresh line.
 */
export function PlanTab({ activity, me, ...props }: PlanTabProps) {
  const { project, plan, view, filters, readAt, signals } = props;
  const counts = Object.fromEntries(Object.entries(plan.board).map(([c, tasks]) => [c, tasks.length])) as Record<PlanColumn, number>;
  const narrowed = useMemo(() => filterPlan(plan, filters, signals.needsYou, me), [plan, filters, signals.needsYou, me]);
  const people = useMemo(() => peopleOf(plan, me), [plan, me]);

  return (
    <div className="flex flex-col gap-3">
      <PlanToolbar
        projectId={project.id}
        view={view}
        filters={filters}
        filterButtons={<PlanFilters projectId={project.id} view={view} filters={filters} epics={plan.epics} counts={counts} unplanned={plan.unplanned.length} me={me} people={people} />}
      />
      <FilterChips projectId={project.id} view={view} filters={filters} epics={plan.epics} />
      <PlanBody {...props} narrowed={narrowed} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{activity && `Last from GitHub: ${activity.summary}, ${formatAgo(activity.receivedAt, new Date(readAt))}`}</span>
        <PlanRefresher readAt={readAt} />
      </div>
    </div>
  );
}
