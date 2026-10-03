"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import type { PlanColumn, PlanView } from "@/server/plan";
import type { PlanSignals } from "@/server/plan-signals";
import type { GitHubActivity } from "@/server/plan-activity";
import { IssuePages } from "@/components/issues/issue-pages";
import { useOptionalVoice } from "@/components/voice/voice-provider";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { formatAgo } from "@/lib/format";
import { planPath } from "@/lib/paths";
import { filterPlan, isFiltered, type NarrowedPlan, type PlanFilters as Filters } from "@/lib/plan/filters";
import type { SchedulerBrief } from "@/lib/plan/flow-text";
import { deriveSpans, type Timeline } from "@/lib/plan/schedule";
import { searchPlan, type SearchResult } from "@/lib/plan/search";
import type { Zoom } from "@/lib/plan/timeline-scale";
import type { PlanModeName, PlanViewName } from "@/lib/project-tab";
import type { StartRunContext } from "./plan-actions";
import { Assigning, SearchQuery, Sizing, type AssignControl } from "./plan-context";
import { PlanBoard } from "./plan-board";
import { PlanEmpty } from "./plan-empty";
import { FlowControls } from "./flow-parts";
import { PlanFlow } from "./plan-flow";
import { FilterChips, PlanFilters } from "./plan-filters";
import { PlanRefresher } from "./plan-refresher";
import { PlanSearchField } from "./plan-search";
import { PlanTimeline } from "./plan-timeline";
import { ExpandCollapse, PlanToolbar } from "./plan-toolbar";
import { PlanTree } from "./plan-tree";
import { TimelineControls, useNarrow } from "./timeline-parts";
import { useCollapsed } from "./use-collapsed";

/** How long the search waits after the last key before it writes ?q= to the URL. */
const URL_DELAY = 150;

/** The Timeline and the Flow show the plan's rows, without the unplanned issues. */
const byRow = (view: PlanViewName) => view === "timeline" || view === "flow";

/** What the search counts in a view: the Flow has the Timeline's rows. */
const matchKey = (view: PlanViewName) => (view === "flow" ? "timeline" : view);

/** Filters that leave nothing to show, with the way back to the whole plan. */
function NoMatches({ projectId, view, q }: { projectId: string; view: PlanViewName; q: string }) {
  return (
    <Empty className="rounded-lg border py-10">
      <EmptyHeader>
        <EmptyTitle>{byRow(view) ? "No items match these filters" : "No tasks match these filters"}</EmptyTitle>
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

/** A search that finds nothing in the view, with the way back. */
function NoSearchMatch({ q, onClear }: { q: string; onClear: () => void }) {
  return (
    <Empty className="rounded-lg border py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>No match for &quot;{q}&quot;</EmptyTitle>
        <EmptyDescription>Search looks at the numbers and titles of epics, stories, tasks and unplanned issues.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear search
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
  /** The filters and the search from the URL. */
  filters: Filters;
  signals: PlanSignals;
  /** The scheduler's next tasks with their place in its order, for the tree's Next tags. */
  next?: Record<number, number> | undefined;
  /** Whether the scheduler is on and its Claude slots, for the Flow's header. */
  scheduler?: SchedulerBrief | undefined;
  start: StartRunContext;
  /** When the page read GitHub, in epoch milliseconds. */
  readAt: number;
  activity: GitHubActivity | null;
  /** The login of the token handoff uses: Me in the Assignee filter and Assign me. Undefined with a GitHub App, which acts as no person. */
  me?: string | undefined;
  /** How rows and cards assign people on GitHub; without it they only show who is assigned. */
  assign?: Omit<AssignControl, "me"> | undefined;
};

type BodyProps = Omit<PlanTabProps, "activity" | "me" | "assign"> & {
  narrowed: NarrowedPlan;
  found: SearchResult;
  onClearSearch: () => void;
  timeline: Timeline;
  todayRef: RefObject<(() => void) | null>;
};

/** What to show in place of the view when there is nothing in it: an empty plan, filters or a search that leave nothing. */
function nothingToShow({ project, plan, view, filters, narrowed, found, onClearSearch }: BodyProps) {
  if (plan.epics.length === 0 && plan.unparented.length === 0 && plan.unplanned.length === 0) {
    return <PlanEmpty reason="empty" project={{ id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }} />;
  }
  // The board shows its columns whatever the filters leave; the timeline has no place for unplanned issues.
  const count = (p: Pick<NarrowedPlan, "epics" | "unparented" | "unplanned">) => p.epics.length + p.unparented.length + (byRow(view) ? 0 : p.unplanned.length);
  if (view !== "board" && count(narrowed) === 0 && isFiltered(filters)) return <NoMatches projectId={project.id} view={view} q={filters.q} />;
  if (found.active && (view === "board" ? found.matches.board : count(found)) === 0) return <NoSearchMatch q={filters.q.trim()} onClear={onClearSearch} />;
  return undefined;
}

/** How many tasks of each epic the filters and the search hide, and which of them hides them. */
function hiddenTasks(narrowed: NarrowedPlan, found: SearchResult) {
  if (!found.active) return { hidden: narrowed.hidden, by: "filters" as const };
  const hidden = Object.fromEntries(found.epics.map((e) => [e.number, (narrowed.hidden[e.number] ?? 0) + (found.hidden[e.number] ?? 0)]));
  return { hidden, by: Object.keys(narrowed.hidden).length > 0 ? ("filters and search" as const) : ("search" as const) };
}

/** The chosen view of the plan narrowed by the filters and the search, or what to say when there is nothing to show. */
function PlanBody(props: BodyProps) {
  const { project, plan, view, zoom, filters, narrowed, found, signals, start, readAt, timeline, todayRef } = props;
  const nothing = nothingToShow(props);
  if (nothing) return nothing;
  const shared = { projectId: project.id, repoUrl: `https://github.com/${project.repoOwner}/${project.repoName}`, needsYou: signals.needsYou, skipped: signals.skipped, ...start };
  const shown = found.active ? found : narrowed;
  const searchOpen = found.active ? found.open : undefined;
  if (view === "flow" && plan.flow) {
    return <PlanFlow {...shared} epics={shown.epics} unparented={shown.unparented} flow={plan.flow} scheduler={props.scheduler} searchOpen={searchOpen} />;
  }
  switch (view) {
    case "board":
      return <PlanBoard {...shared} project={plan.project} board={shown.board} epics={plan.epics} now={readAt} searching={found.active} />;
    case "timeline":
      return (
        <PlanTimeline
          {...shared}
          project={plan.project}
          epics={shown.epics}
          unparented={shown.unparented}
          timeline={timeline}
          zoom={zoom}
          filters={filters}
          readAt={readAt}
          todayRef={todayRef}
          searchOpen={searchOpen}
        />
      );
    default: {
      const { hidden, by } = hiddenTasks(narrowed, found);
      return <PlanTree {...shared} next={props.next} epics={shown.epics} unparented={shown.unparented} unplanned={shown.unplanned} hidden={hidden} hiddenBy={by} searchOpen={searchOpen} />;
    }
  }
}


/** Everyone assigned to a task in the plan other than me, by login. */
function peopleOf(plan: PlanView, me: string | undefined): string[] {
  const logins = new Set(Object.values(plan.board).flatMap((tasks) => tasks.flatMap((t) => t.assignees.map((a) => a.login))));
  return [...logins].filter((l) => l.toLowerCase() !== me?.toLowerCase()).toSorted((a, b) => a.localeCompare(b));
}

/** The collapse keys of the rows that open and close in a view: epics, stories, and the tree's Unparented and Unplanned blocks. */
function rowsOf(plan: NarrowedPlan, view: PlanViewName): string[] {
  return [
    ...plan.epics.flatMap((e) => [`e${e.number}`, ...e.stories.map((s) => `s${s.number}`)]),
    ...(plan.unparented.length ? ["unparented"] : []),
    ...(view === "tree" && plan.unplanned.length ? ["unplanned"] : []),
  ];
}

/** The search text, with ?q= written to the URL a moment after the last key so a link or a refresh keeps it. */
function useSearchText(initial: string, url: (q: string) => string) {
  const [text, setText] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    // The native history API keeps the page as it is: the search narrows what is loaded and reads nothing new.
    timer.current = setTimeout(() => window.history.replaceState(null, "", url(next.trim())), URL_DELAY);
  };
  return [text, change] as const;
}

/** The first element to focus in the plan: the first match, or the row or card the plan would focus first. */
function firstIn(body: HTMLElement | null, match: boolean): HTMLElement | null {
  if (!body) return null;
  const tree = match ? body.querySelector<HTMLElement>("[role=tree] [role=treeitem][data-match]") : body.querySelector<HTMLElement>('[role=tree] [role=treeitem][tabindex="0"]');
  return tree ?? body.querySelector<HTMLElement>(match ? "[data-match] a[data-title], a[data-title]" : "a[data-title]");
}

/**
 * The Plan page under its header: the toolbar with the view, the search and the filters, the tree, the
 * board or the timeline narrowed by them, and at the bottom the latest change GitHub reported with the
 * refresh line. The search narrows the plan as it is loaded; it reads nothing from GitHub.
 */
export function PlanTab({ activity, me, assign, ...props }: PlanTabProps) {
  const { project, plan, view, zoom, filters, readAt, signals } = props;
  // loadPlan lays out a flow for a project in Flow mode only.
  const mode: PlanModeName = plan.flow ? "flow" : "timeline";
  const voice = useOptionalVoice();
  const narrow = useNarrow();
  const todayRef = useRef<(() => void) | null>(null);
  const timeline = useMemo(() => plan.timeline ?? deriveSpans([], [], new Date(readAt)), [plan.timeline, readAt]);
  const collapsed = useCollapsed(project.id);
  const body = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useSearchText(filters.q, (q) => planPath(project.id, { view, ...filters, q, zoom }));
  const counts = Object.fromEntries(Object.entries(plan.board).map(([c, tasks]) => [c, tasks.length])) as Record<PlanColumn, number>;
  const narrowed = useMemo(() => filterPlan(plan, filters, signals.needsYou, me), [plan, filters, signals.needsYou, me]);
  const found = useMemo(() => searchPlan(narrowed, query), [narrowed, query]);
  const people = useMemo(() => peopleOf(plan, me), [plan, me]);
  const assigning = useMemo(() => assign && { ...assign, me }, [assign, me]);
  const sizing = useMemo(() => {
    if (!plan.forecasts || plan.capacity === undefined) return undefined;
    const spans = new Map(timeline.items.map((i) => [i.number, i.planned]));
    return { projectId: project.id, projectName: project.name, forecasts: plan.forecasts, capacity: plan.capacity, spanOf: (issue: number) => spans.get(issue) };
  }, [plan.forecasts, plan.capacity, timeline.items, project.id, project.name]);
  const current = { ...filters, q: query.trim() };

  // Voice owns Escape while it speaks or listens; the search keeps its text then.
  const voiceBusy = !!voice && (voice.speech.speaking || voice.state === "listening" || voice.state === "starting" || voice.bubble.open);
  /** Escape on a row or a card during a search: clears it and keeps that item in view, its epic and story saved open. */
  const onBodyKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !found.active || voiceBusy || e.defaultPrevented) return;
    const keys: string[] = [];
    for (let row = (e.target as HTMLElement).closest<HTMLElement>("[role=treeitem]"); row; row = row.parentElement?.closest<HTMLElement>("[role=treeitem]") ?? null) {
      if (row.dataset.key && /^(e|s)\d+$|^unparented$|^unplanned$/.test(row.dataset.key)) keys.push(row.dataset.key);
    }
    if (keys.length) collapsed.expand(keys);
    setQuery("");
  };

  return (
    <Assigning value={assigning}>
      <Sizing value={sizing}>
      <SearchQuery value={found.active ? query.trim() : ""}>
        <div className="flex flex-col gap-3">
          <PlanToolbar
            projectId={project.id}
            view={view}
            mode={mode}
            filters={current}
            expand={view !== "board" && <ExpandCollapse projectId={project.id} rows={rowsOf(narrowed, view)} searching={found.active} />}
            search={
              <PlanSearchField
                value={query}
                onChange={setQuery}
                count={found.matches[matchKey(view)]}
                hint={!byRow(view)}
                onLeave={() => firstIn(body.current, false)?.focus()}
                onFirstMatch={() => firstIn(body.current, true)?.focus()}
                className="max-w-90 min-w-36 flex-1 basis-40"
              />
            }
            filterButtons={<PlanFilters projectId={project.id} view={view} filters={current} epics={plan.epics} counts={counts} unplanned={plan.unplanned.length} me={me} people={people} />}
            controls={
              view === "timeline" ? (
                <TimelineControls projectId={project.id} filters={current} timeline={timeline} zoom={zoom} narrow={narrow} onToday={() => todayRef.current?.()} />
              ) : (
                view === "flow" && <FlowControls projectId={project.id} />
              )
            }
          />
          <FilterChips projectId={project.id} view={view} filters={current} epics={plan.epics} />
          <div ref={body} onKeyDown={onBodyKeyDown}>
            <IssuePages projectId={project.id}>
              <PlanBody {...props} filters={current} narrowed={narrowed} found={found} onClearSearch={() => setQuery("")} timeline={timeline} todayRef={todayRef} />
            </IssuePages>

          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{activity && `Last from GitHub: ${activity.summary}, ${formatAgo(activity.receivedAt, new Date(readAt))}`}</span>
            <PlanRefresher readAt={readAt} />
          </div>
        </div>
      </SearchQuery>
      </Sizing>
    </Assigning>
  );
}
