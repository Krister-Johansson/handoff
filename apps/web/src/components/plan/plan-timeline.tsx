"use client";

import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, CalendarIcon, ChevronRightIcon, ExternalLinkIcon, MoreHorizontalIcon } from "lucide-react";
import type { PlanItem } from "@handoff/github";
import { StatusBadge } from "@/components/runs/status-badge";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { DaySpan, TimelineItem } from "@/lib/plan/schedule";
import { BAR_TONE, prNumberOf, taskColumn } from "@/lib/plan/task";
import {
  arrowPath,
  chartRange,
  itemsOf,
  KIND_NAME,
  lacksDateFields,
  placeItem,
  progressOf,
  scheduleNotes,
  spanText,
  stripDates,
  timelineRows,
  type TimelineRow,
} from "@/lib/plan/timeline-rows";
import { matchesQuery } from "@/lib/plan/search";
import { addDays, defaultZoom, shortDay, timeScale, type TimeScale } from "@/lib/plan/timeline-scale";
import { runPath } from "@/lib/paths";
import { statusTone, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { TaskActions, type StartRunContext } from "./plan-actions";
import { KindBadge, StatusPill } from "./plan-status";
import { useSearchQuery } from "./plan-context";
import { IssueTitle } from "./plan-task-parts";
import { PlanTimelineList } from "./plan-timeline-list";
import { ScheduleDialog } from "./schedule-dialog";
import { DateFieldsBanner, TimeChips, TimeFlags, useNarrow, type TimelineProps } from "./timeline-parts";

import { useRowsOpen } from "./use-collapsed";

const LABEL_WIDTH = 280;
/** A bar wider than this repeats the title inside it. */
const TITLE_INSIDE = 120;
/** A strip wider than this shows the run's short id beside it. */
const ID_BESIDE = 40;
/** Strips start under the 20 px bar, 6 px tall with a 2 px gap. */
const stripTop = (index: number) => 29 + index * 8;

/** A run strip in its run's status colour, as StatusBadge colours the run. */
const STRIP_TONE: Record<StatusTone, string> = {
  success: "bg-success-dot",
  active: "bg-active-dot",
  attention: "bg-attention-dot",
  danger: "bg-danger-dot",
  repaired: "bg-repaired-dot",
  neutral: "bg-muted-foreground/60",
  muted: "bg-muted-foreground/35",
};

const rowLabel = (row: TimelineRow) => (row.item ? `${KIND_NAME[row.kind]} #${row.item.number} ${row.item.title}` : "Unparented");
const isHead = (row: TimelineRow) => row.kind === "epic" || row.kind === "group";

/** The left edge and width of a span of whole days. */
function extent(scale: TimeScale, span: DaySpan) {
  const left = scale.x(span.start);
  return { left, width: scale.x(addDays(span.end, 1)) - left };
}

/** What the chart knows about one item, for its hover card. */
type CardContext = { items: Map<number, PlanItem>; entries: Map<number, TimelineItem>; projectId: string };

/** The hover card of a bar or a row title: kind, status, dates and where they come from, blockers, latest run and pull request. */
function ItemCard({ row, entry, ctx, children }: { row: TimelineRow; entry: TimelineItem; ctx: CardContext; children: ReactNode }) {
  const item = row.item!;
  const task = row.task;
  const span = entry.planned ? "Own dates" : entry.derived ? "Derived from its tasks" : "Not scheduled";
  const progress = progressOf(item);
  const pr = task && prNumberOf(task);
  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className="flex w-75 flex-col gap-2 text-xs">
        <p className="text-[13px] leading-snug font-semibold">
          #{item.number} {item.title}
        </p>
        <dl className="grid grid-cols-[74px_minmax(0,1fr)] gap-x-2.5 gap-y-1">
          <dt className="text-muted-foreground">Kind</dt>
          <dd>{KIND_NAME[row.kind]}</dd>
          {task && (
            <>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <StatusPill column={taskColumn(task)} />
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Start</dt>
          <dd>{item.start ? shortDay(item.start) : "Not set"}</dd>
          <dt className="text-muted-foreground">Target</dt>
          <dd>{item.target ? shortDay(item.target) : "Not set"}</dd>
          <dt className="text-muted-foreground">Span</dt>
          <dd>{entry.derived && !entry.planned ? `${span}, ${spanText(entry.derived)}` : span}</dd>
          {progress && (
            <>
              <dt className="text-muted-foreground">Progress</dt>
              <dd>
                {progress.done} of {progress.total} done
              </dd>
            </>
          )}
          {entry.waitingOn.length > 0 && (
            <>
              <dt className="text-muted-foreground">Blocked by</dt>
              <dd className="flex flex-col gap-1">
                {entry.waitingOn.map((n) => {
                  const blocker = ctx.items.get(n);
                  return (
                    <span key={n} className="flex flex-wrap items-center gap-1.5">
                      #{n} {blocker?.title}
                      {blocker && <StatusPill column={blocker.state === "closed" ? "Done" : (blocker.status ?? "Other")} />}
                    </span>
                  );
                })}
              </dd>
            </>
          )}
          {task && (
            <>
              <dt className="text-muted-foreground">Latest run</dt>
              <dd>
                {task.run ? (
                  <Link href={runPath(ctx.projectId, task.run.id)} className="rounded-full">
                    <StatusBadge status={task.run.status} size="sm" />
                  </Link>
                ) : (
                  "None yet"
                )}
              </dd>
              <dt className="text-muted-foreground">Pull request</dt>
              <dd>{pr !== undefined ? `#${pr}` : "None"}</dd>
            </>
          )}
        </dl>
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <span className="flex flex-wrap gap-1">{task && <TimeChips task={task} entry={entry} window="story" />}</span>
          <a href={item.url} className="shrink-0 underline underline-offset-3 hover:text-foreground">
            Open on GitHub
          </a>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

const FOCUS = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none";
/** A one-sided span: the missing side's edge is dashed. */
const openEdges = (entry: TimelineItem) => cn(entry.planned?.openStart && "[border-left-style:dashed]", entry.planned?.openEnd && "[border-right-style:dashed]");

type BarProps = { row: TimelineRow; entry: TimelineItem; span: DaySpan; scale: TimeScale; ctx: CardContext };

/** A task's bar in its status colour, with a red left edge when late and a hatched tail to today when overdue. */
function TaskBar({ row, entry, span, scale, todayX, ctx }: BarProps & { todayX: number }) {
  const item = row.item!;
  const column = taskColumn(row.task!);
  const { left, width } = extent(scale, span);
  const blocked = entry.waitingOn.length ? `, blocked by ${entry.waitingOn.map((n) => `#${n}`).join(", ")}` : "";
  const overdue = entry.overdueDays !== undefined && todayX > left + width;
  return (
    <>
      {overdue && (
        <span
          aria-hidden
          data-bar
          className="absolute top-1.5 z-[1] h-5 rounded-r-[5px] border-[1.5px] border-l-0 border-dashed border-attention-dot bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--attention-dot)_45%,transparent)_0_2px,transparent_2px_6px)]"
          style={{ left: left + width - 3, width: todayX - (left + width) + 3 }}
        />
      )}
      <ItemCard row={row} entry={entry} ctx={ctx}>
        <a
          href={item.url}
          data-bar
          data-column={column}
          data-late={entry.late}
          aria-label={`Task #${item.number} ${item.title}, ${column}, ${spanText(span)}${blocked}`}
          className={cn(
            "absolute top-1.5 z-[2] flex h-5 items-center overflow-hidden rounded-[5px] border-2 px-1.5 text-[11px] font-medium whitespace-nowrap text-foreground",
            FOCUS,
            BAR_TONE[column],
            openEdges(entry),
            entry.late && "border-l-[5px] border-l-danger-dot",
          )}
          style={{ left, width }}
        >
          {width > TITLE_INSIDE && <span className="truncate">{item.title}</span>}
        </a>
      </ItemCard>
    </>
  );
}

/** An epic's or a story's span: its own dates as a neutral bar with a thin progress line, or a dashed bracket when derived. */
function SpanBar({ row, entry, span, scale, ctx }: BarProps) {
  const item = row.item!;
  const { left, width } = extent(scale, span);
  const name = `${KIND_NAME[row.kind]} #${item.number} ${item.title}, ${spanText(span)}`;
  const progress = progressOf(item);
  const done = progress && progress.total > 0 ? progress.done / progress.total : undefined;
  return (
    <ItemCard row={row} entry={entry} ctx={ctx}>
      {entry.planned ? (
        <a
          href={item.url}
          data-bar
          data-span="own"
          aria-label={`${name}, own dates${progress ? `, ${progress.done} of ${progress.total} done` : ""}`}
          className={cn("absolute top-2.5 z-[2] h-[15px] overflow-hidden rounded-[4px] border border-muted-foreground/40 bg-secondary", FOCUS, openEdges(entry))}
          style={{ left, width }}
        >
          {done !== undefined && <span aria-hidden className="absolute bottom-0 left-0 h-[3px] bg-success-dot" style={{ width: `${done * 100}%` }} />}
        </a>
      ) : (
        <a
          href={item.url}
          data-bar
          data-span="derived"
          aria-label={`${name}, derived from its tasks`}
          className={cn("absolute top-2.5 z-[2] h-[15px] rounded-[4px] border-[1.5px] border-dashed border-muted-foreground/60", FOCUS)}
          style={{ left, width }}
        />
      )}
    </ItemCard>
  );
}

/** A row's planned bar: a task's in its status colour, an epic's or a story's in neutral, a derived span as a dashed bracket. */
function PlannedBar(props: Omit<BarProps, "span"> & { todayX: number }) {
  const span = props.entry.planned ?? props.entry.derived;
  if (!span) return null;
  return props.row.task ? <TaskBar {...props} span={span} /> : <SpanBar {...props} span={span} />;
}

/** One strip per run that linked the task, newest at the top, each opening its run. */
function Strips({ row, entry, scale, projectId }: { row: TimelineRow; entry: TimelineItem; scale: TimeScale; projectId: string }) {
  const item = row.item!;
  return entry.actual.map((strip, i) => {
    const left = scale.xAt(strip.start);
    const width = Math.max(2, scale.xAt(strip.end) - left);
    const short = strip.runId.slice(0, 8);
    return (
      <Fragment key={strip.runId}>
        <Link
          href={runPath(projectId, strip.runId)}
          data-bar
          aria-label={`Run ${short} of #${item.number} ${item.title}, ${strip.status}, ${stripDates(strip)}`}
          title={`#${item.number} ${item.title}, ${strip.status}`}
          className={cn("absolute z-[2] h-1.5 rounded-[2px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", STRIP_TONE[statusTone(strip.status)])}
          style={{ left, width, top: stripTop(i) }}
        />
        {width > ID_BESIDE && scale.zoom === "weeks" && (
          <span aria-hidden data-bar className="absolute z-[2] font-mono text-[9.5px] leading-[10px] whitespace-nowrap text-muted-foreground" style={{ left: left + width + 4, top: stripTop(i) - 2 }}>
            {short}
          </span>
        )}
      </Fragment>
    );
  });
}

function Chevron({ expanded, label, onToggle }: { expanded: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
      onClick={onToggle}
      className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ChevronRightIcon aria-hidden className={cn("size-4 transition-transform", expanded && "rotate-90")} />
    </button>
  );
}

/** An epic's or a story's menu on the timeline: Open on GitHub and Schedule. */
function ItemMenu({ item, onSchedule }: { item: PlanItem; onSchedule: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`Actions for #${item.number}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <a href={item.url}>
              <ExternalLinkIcon />
              Open on GitHub
            </a>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onSchedule}>
            <CalendarIcon />
            Schedule
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type RowLabelProps = {
  row: TimelineRow;
  entry: TimelineItem | undefined;
  window: "story" | "epic";
  projectId: string;
  start: StartRunContext;
  needsYou: readonly string[];
  onToggle: () => void;
  onSchedule: (item: PlanItem) => void;
};

/** A task's status pill, or an epic's or a story's kind badge; nothing on the Unparented heading. */
function RowMark({ row }: { row: TimelineRow }) {
  if (row.task) {
    const column = taskColumn(row.task);
    return <StatusPill column={column} spinning={column === "Running" && row.task.run?.status === "running"} />;
  }
  return row.item ? <KindBadge kind={row.kind === "story" ? "story" : "epic"} /> : null;
}

/** A task's menu with the moves its status allows and Schedule; an epic's or a story's with Open on GitHub and Schedule. */
function RowMenu({ row, projectId, start, onSchedule }: Pick<RowLabelProps, "row" | "projectId" | "start" | "onSchedule">) {
  const { item, task } = row;
  if (task) return <TaskActions task={task} projectId={projectId} start={start} compact onSchedule={() => onSchedule(task)} />;
  return item ? <ItemMenu item={item} onSchedule={() => onSchedule(item)} /> : null;
}

const INDENT: Record<TimelineRow["level"], string> = { 1: "pl-2.5", 2: "pl-[26px]", 3: "pl-11" };

/** The fixed left cell of a row: chevron, status pill or kind badge, number and title with a task's warning icon, then the menu. */
function RowLabel({ row, entry, window, projectId, start, needsYou, onToggle, onSchedule }: RowLabelProps) {
  const { item, task } = row;
  return (
    <div
      role="rowheader"
      className={cn(
        "sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-r border-b bg-card pr-2.5 transition-shadow",
        "group-data-[scrolled=true]/grid:shadow-[8px_0_10px_-8px_color-mix(in_oklab,var(--foreground)_25%,transparent)]",
        "group-data-[related=true]/row:bg-[linear-gradient(var(--active-bg),var(--active-bg))]",
        INDENT[row.level],
        isHead(row) && "bg-muted",
      )}
      style={{ width: LABEL_WIDTH }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {row.expanded !== undefined && <Chevron expanded={row.expanded} label={rowLabel(row)} onToggle={onToggle} />}
        <RowMark row={row} />
        {item ? <IssueTitle item={item} className={cn("text-xs", !task && "font-medium")} /> : <span className="text-[13px] font-medium">Unparented</span>}
        {task && entry && <TimeFlags task={task} entry={entry} window={window} needsYou={needsYou} />}
        <span className="ml-auto shrink-0">
          <RowMenu row={row} projectId={projectId} start={start} onSchedule={onSchedule} />
        </span>
      </div>
    </div>
  );
}

type UnscheduledGroup = { title: string; items: PlanItem[] };

/** Items with neither dates nor a derived span, grouped by epic, each with a Schedule button. */
function Unscheduled({ groups, undated, onSchedule }: { groups: UnscheduledGroup[]; undated: boolean; onSchedule: (item: PlanItem) => void }) {
  const [open, setOpen] = useState(true);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  if (count === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section aria-label="Unscheduled" className="border-t">
        <CollapsibleTrigger className="flex w-full items-center gap-2 bg-muted/50 px-3.5 py-2.5 text-left text-[13px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
          <ChevronRightIcon aria-hidden className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="font-medium">Unscheduled</span>
          <Tag tone="fill">{count}</Tag>
          <span className="text-xs text-muted-foreground">No Start and no Target</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {undated && <p className="px-3.5 pt-1 pb-2.5 pl-[38px] text-[13px] text-muted-foreground">Give tasks a Start and Target to see them on the timeline, or ask the assistant to schedule an epic.</p>}
          {groups.map((group) => (
            <div key={group.title}>
              <p className="px-3.5 pt-2 pb-0.5 pl-[38px] text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group.title}</p>
              <ul>
                {group.items.map((item) => {
                  const kind = item.kind ?? "task";
                  return (
                    <li key={item.number} className="flex min-w-0 items-center gap-2 border-t px-3.5 py-1.5 pl-[38px]">
                      <KindBadge kind={kind} />
                      <IssueTitle item={item} className="text-xs" />
                      {kind === "task" && <StatusPill column={item.state === "closed" ? "Done" : (item.status ?? "Other")} />}
                      <Button size="xs" variant="outline" className="ml-auto" aria-label={`Schedule #${item.number} ${item.title}`} onClick={() => onSchedule(item)}>
                        <CalendarIcon data-icon="inline-start" />
                        Schedule
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/** The part of the time pane in view, for the marker that points to today when it is out of view. */
type PaneView = { left: number; width: number };

/**
 * The plan as a Gantt chart: a fixed column of row labels in the tree's order and a time pane that
 * scrolls sideways, with planned bars, run strips and dependency arrows. Hovering a row keeps its
 * arrows and the rows at their other ends strong and dims the rest.
 */
function TimelineChart({ projectId, project, epics, unparented, timeline, zoom, readAt, graphs, graphName, needsYou, todayRef, searchOpen }: TimelineProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const rowsOpen = useRowsOpen(projectId, searchOpen);
  const q = useSearchQuery();
  const [scheduling, setScheduling] = useState<PlanItem>();
  const [hovered, setHovered] = useState<number>();
  const [pane, setPane] = useState<PaneView>();
  const entries = useMemo(() => new Map(timeline.items.map((i) => [i.number, i])), [timeline.items]);
  const items = useMemo(() => itemsOf(epics, unparented), [epics, unparented]);
  const stories = useMemo(() => new Set(epics.flatMap((e) => e.stories.map((s) => s.number))), [epics]);
  const ctx: CardContext = { items, entries, projectId };

  const { rows, height, anchor } = timelineRows(epics, unparented, rowsOpen.isOpen, (n) => entries.get(n)?.actual.length ?? 0);
  const range = chartRange(timeline);
  const scale = timeScale(range, zoom ?? defaultZoom(range));
  const todayX = scale.xAt(new Date(readAt).toISOString());

  const measure = () => {
    const el = scroller.current;
    if (el && el.clientWidth > 0) setPane({ left: el.scrollLeft, width: el.clientWidth - LABEL_WIDTH });
  };
  /** Puts today in the middle of the time pane. */
  const scrollToToday = (behavior: ScrollBehavior) => {
    const el = scroller.current;
    el?.scrollTo({ left: Math.max(0, todayX - (el.clientWidth - LABEL_WIDTH) / 2), behavior });
  };
  const openOnToday = useEffectEvent(() => {
    scrollToToday("instant");
    measure();
  });
  // The chart opens on today, and again when the zoom changes the scale; a refresh keeps the scroll.
  useEffect(() => openOnToday(), [scale.zoom]);
  // The toolbar's Today button scrolls the chart back to today.
  const toToday = useEffectEvent(() => scrollToToday("smooth"));
  useEffect(() => {
    if (!todayRef) return;
    todayRef.current = () => toToday();
    return () => {
      todayRef.current = null;
    };
  }, [todayRef]);

  const barOf = (n: number) => {
    const span = entries.get(n)?.planned ?? entries.get(n)?.derived;
    if (!span) return undefined;
    const { left, width } = extent(scale, span);
    return { left, right: left + width };
  };
  const stripsOf = (n: number) => {
    const actual = entries.get(n)?.actual ?? [];
    if (actual.length === 0) return undefined;
    return { left: Math.min(...actual.map((a) => scale.xAt(a.start))), right: Math.max(...actual.map((a) => scale.xAt(a.end))) };
  };
  const arrows = timeline.arrows.flatMap((arrow) => {
    const from = placeItem(arrow.from, anchor, barOf, stripsOf);
    const to = placeItem(arrow.to, anchor, barOf, stripsOf);
    if (!from || !to || (from.row === to.row && !from.own)) return [];
    return [{ ...arrow, start: from, end: to, d: arrowPath(from, to) }];
  });
  const touches = (a: (typeof arrows)[number]) => hovered !== undefined && (a.from === hovered || a.to === hovered);
  const related = new Set(hovered === undefined ? [] : [hovered, ...arrows.filter(touches).flatMap((a) => [a.from, a.to])]);

  const unscheduled: UnscheduledGroup[] = [
    ...epics.map((e) => ({ title: e.title, items: [e, ...e.stories.flatMap((s) => [s, ...s.tasks]), ...e.tasks] })),
    { title: "Unparented", items: unparented },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => entries.get(i.number)?.unscheduled) }))
    .filter((g) => g.items.length > 0);

  const offscreen = pane && (todayX < pane.left ? "left" : todayX > pane.left + pane.width ? "right" : undefined);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {lacksDateFields(project) && <DateFieldsBanner projectId={projectId} project={project} />}
      <div className="relative">
        <div ref={scroller} className="overflow-x-auto overscroll-x-contain" onScroll={measure}>
          <div
            role="grid"
            aria-label="Timeline"
            aria-rowcount={rows.length + 1}
            data-scrolled={(pane?.left ?? 0) > 0}
            className="group/grid relative text-[13px]"
            style={{ width: LABEL_WIDTH + scale.width, minWidth: "100%" }}
          >
            <div role="rowgroup">
              <div role="row" aria-label="Time axis" className="flex h-12">
                <div
                  role="columnheader"
                  className="sticky left-0 z-10 flex items-end border-r border-b bg-card px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
                  style={{ width: LABEL_WIDTH }}
                >
                  Item
                </div>
                <div role="columnheader" aria-label={`${shortDay(scale.range.start)} to ${shortDay(scale.range.end)}`} className="relative flex-1 border-b" style={{ minWidth: scale.width }}>
                  {scale.top.map((c) => (
                    <span key={`t${c.x}`} className="absolute top-0 flex h-6 items-center truncate border-l pl-1.5 text-[11px] font-medium" style={{ left: c.x, width: c.width }}>
                      {c.label}
                    </span>
                  ))}
                  {scale.bottom.map((c) => (
                    <span key={`b${c.x}`} className="absolute top-6 flex h-6 items-center truncate border-t border-l pl-1.5 font-mono text-[10.5px] text-muted-foreground" style={{ left: c.x, width: c.width }}>
                      {c.label}
                    </span>
                  ))}
                  <span className="absolute top-7 z-[4] ml-1 rounded-[4px] bg-foreground px-1.5 py-px text-[9.5px] font-semibold text-background" style={{ left: todayX }}>
                    Today
                  </span>
                </div>
              </div>
            </div>
            <div role="rowgroup" className="relative" style={{ height }} onPointerLeave={() => setHovered(undefined)}>
              {rows.map((row) => {
                const entry = row.item && entries.get(row.item.number);
                const isRelated = row.item !== undefined && related.has(row.item.number);
                return (
                  <div
                    key={row.key}
                    role="row"
                    aria-label={rowLabel(row)}
                    aria-expanded={row.expanded}
                    data-related={isRelated}
                    data-match={(row.item && matchesQuery(row.item, q)) || undefined}
                    className={cn("group/row absolute inset-x-0 flex", isHead(row) && "bg-muted/50", isRelated && "bg-active-bg")}
                    style={{ top: row.top, height: row.height }}
                    onPointerEnter={() => setHovered(row.task ? row.task.number : undefined)}
                  >
                    <RowLabel
                      row={row}
                      entry={entry}
                      window={row.item?.parent !== undefined && stories.has(row.item.parent) ? "story" : "epic"}
                      projectId={projectId}
                      start={{ graphs, graphName }}
                      needsYou={needsYou}
                      onToggle={() => rowsOpen.toggle(row.key)}

                      onSchedule={setScheduling}
                    />
                    <div role="gridcell" className={cn("relative flex-1 border-b", hovered !== undefined && !isRelated && "[&_[data-bar]]:opacity-35")} style={{ minWidth: scale.width }}>
                      {entry && <PlannedBar row={row} entry={entry} scale={scale} todayX={todayX} ctx={ctx} />}
                      {entry && row.task && <Strips row={row} entry={entry} scale={scale} projectId={projectId} />}
                    </div>
                  </div>
                );
              })}
              <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: LABEL_WIDTH, width: scale.width }}>
                {scale.weekends.map((c) => (
                  <span key={c.x} className="absolute inset-y-0 bg-foreground/[0.035]" style={{ left: c.x, width: c.width }} />
                ))}
                {scale.bottom.map((c) => (
                  <span key={c.x} className="absolute inset-y-0 w-px bg-border/70" style={{ left: c.x }} />
                ))}
                <svg className="absolute inset-0 z-[1] overflow-visible" width={scale.width} height={height}>
                  {arrows.map((a) => (
                    <g
                      key={`${a.from}-${a.to}`}
                      data-arrow={`${a.from}-${a.to}`}
                      data-late={a.late}
                      className={cn(a.late ? "text-danger-dot" : "text-muted-foreground", hovered !== undefined && (touches(a) ? !a.late && "text-foreground" : "opacity-25"))}
                    >
                      <path d={a.d} fill="none" stroke="currentColor" strokeWidth={touches(a) ? 2.25 : a.late ? 1.75 : 1.25} />
                      <path d={`M${a.end.left} ${a.end.y} l-5 -3.5 v7 z`} fill="currentColor" />
                      {!a.start.own && <circle cx={a.start.right} cy={a.start.y} r={2.5} fill="currentColor" />}
                    </g>
                  ))}
                </svg>
                <span className="absolute inset-y-0 z-[3] w-0.5 -translate-x-1/2 bg-foreground/85" style={{ left: todayX }} />
              </div>
            </div>
          </div>
        </div>
        {offscreen && (
          <button
            type="button"
            onClick={() => scrollToToday("smooth")}
            className={cn(
              "absolute top-[25px] z-20 inline-flex h-[22px] items-center gap-1 rounded-full bg-foreground px-2 text-[11px] font-semibold text-background shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              offscreen === "right" && "right-2",
            )}
            style={offscreen === "left" ? { left: LABEL_WIDTH + 6 } : undefined}
          >
            {offscreen === "left" && <ArrowLeftIcon aria-hidden className="size-3" />}
            Today, {shortDay(timeline.today)}
            {offscreen === "right" && <ArrowRightIcon aria-hidden className="size-3" />}
          </button>
        )}
      </div>
      <Unscheduled groups={unscheduled} undated={timeline.items.every((i) => !i.planned)} onSchedule={setScheduling} />
      <ScheduleDialog projectId={projectId} item={scheduling} notes={scheduling ? scheduleNotes(scheduling, items, entries) : []} onOpenChange={(open) => !open && setScheduling(undefined)} />
    </div>
  );
}

/** The Timeline view: the chart, or under 640 px the list form with dates as text. */
export function PlanTimeline(props: TimelineProps) {
  return useNarrow() ? <PlanTimelineList {...props} /> : <TimelineChart {...props} />;
}
