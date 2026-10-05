"use client";

import { Fragment, startTransition, use, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftIcon, ArrowRightIcon, CalendarIcon, CalendarRangeIcon, ChevronRightIcon, GripVerticalIcon, KeyboardIcon, TriangleAlertIcon } from "lucide-react";
import type { PlanItem } from "@handoff/github";
import type { PlanColumn, PlanEpic, PlanTask } from "@/server/plan";
import { moveItemAction, saveArrangeAction } from "@/app/projects/actions";
import { StatusBadge } from "@/components/runs/status-badge";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDuration } from "@/lib/plan/duration";
import type { Duration, Forecast } from "@/lib/plan/forecast";
import { hoursByDay } from "@/lib/plan/load";
import { arrangeTimeline } from "@/lib/plan/arrange";
import { durationIn, moveBack, moveTip, planMove, type MoveContext, type MovePlan } from "@/lib/plan/move";
import type { DaySpan, PlannedSpan, Timeline, TimelineItem } from "@/lib/plan/schedule";
import { durationInWords, hoursInWords, usually } from "@/lib/plan/size-text";
import { BAR_TONE, canMove, prNumberOf, taskColumn } from "@/lib/plan/task";
import {
  arrowPath,
  chartRange,
  isHead,
  itemsOf,
  KIND_NAME,
  LABEL_WIDTH,
  placeItem,
  progressOf,
  rowLabel,
  scheduleNotes,
  spanText,
  stripClock,
  stripDates,
  tasksOf,
  timelineFieldsGap,
  timelineRows,
  type TimelineRow,
} from "@/lib/plan/timeline-rows";
import { matchesQuery } from "@/lib/plan/search";
import { addDays, dayAt, dayWidthAt, defaultZoom, shortDay, timeScale, type TimeScale } from "@/lib/plan/timeline-scale";
import { runPath } from "@/lib/paths";
import { statusTone, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { ArrangeBanner, ArrangeButton, type ArrangeControl } from "./arrange-preview";
import { ItemMenu, RowLabel } from "./row-label";
import { TaskActions, type StartRunContext } from "./plan-actions";
import { KindBadge, StatusPill } from "./plan-status";
import { Sizing, useSearchQuery } from "./plan-context";
import { SizeChip, SizeSum } from "./size-chip";
import { IssueTitle } from "./plan-task-parts";
import { PlanTimelineList } from "./plan-timeline-list";
import { ScheduleDialog } from "./schedule-dialog";
import { FlagCard, type FlagContext } from "./timeline-flag-card";
import { TimeChips, TimelineFieldsBanner, useNarrow, type TimelineProps } from "./timeline-parts";
import { CapacityPopover } from "@/components/settings/capacity-popover";
import { LoadRow } from "./load-row";
import { useBarDrag, type DragBar } from "./use-bar-drag";
import { useRowsOpen } from "./use-collapsed";

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


/** The left edge and width of a span of whole days. */
function extent(scale: TimeScale, span: DaySpan) {
  const left = scale.x(span.start);
  return { left, width: scale.x(addDays(span.end, 1)) - left };
}

/** Pixels an hour of work takes on a day: the day's width over the person's hours a day. */
const hourWidthAt = (scale: TimeScale, day: string, capacity: number) => dayWidthAt(scale, day) / capacity;

/**
 * Where a bar sits: a sized task's from its Start day after its offset, as long as its hours at the
 * capacity; any other span over its whole days.
 */
function barBox(scale: TimeScale, span: DaySpan & Partial<PlannedSpan>, capacity: number | undefined) {
  if (span.hours === undefined || capacity === undefined) return extent(scale, span);
  const hour = hourWidthAt(scale, span.start, capacity);
  return { left: scale.x(span.start) + (span.offsetHours ?? 0) * hour, width: span.hours * hour };
}

/** What the chart knows about one item, for its hover card. */
type CardContext = { items: Map<number, PlanItem>; entries: Map<number, TimelineItem>; projectId: string; move: MoveContext };

/** Minutes as hours and minutes whatever the capacity: "1h 40m". */
const minutesText = (minutes: number) => formatDuration(minutes / 60, Infinity);

/** What a size usually takes in this project, with its parts and cost, or its default with the runs so far. */
function ForecastRow({ forecast, capacity }: { forecast: Forecast; capacity: number }) {
  const sofar = forecast.runs === 0 ? `no finished ${forecast.size} runs yet` : `${forecast.runs} finished ${forecast.size} ${forecast.runs === 1 ? "run" : "runs"} so far`;
  const where = forecast.source === "runs" ? `the median of ${forecast.runs} finished ${forecast.size} runs` : `the default for ${forecast.size}; ${sofar}`;
  const cost = forecast.costUsd !== null ? `, about $${forecast.costUsd.toFixed(2)}` : "";
  return (
    <>
      <dt className="text-muted-foreground">Forecast</dt>
      <dd className="flex flex-col">
        <span>
          ~{usually(forecast, capacity)}, {where}
        </span>
        {forecast.parts && (
          <span className="text-muted-foreground">
            agent {minutesText(forecast.parts.agent)}, queue {minutesText(forecast.parts.queue)}, waiting on you {minutesText(forecast.parts.waiting)}
            {cost}
          </span>
        )}
      </dd>
    </>
  );
}

/** How long the active run has gone, and how far past the duration. */
function ActualRow({ entry }: { entry: TimelineItem }) {
  const active = entry.actual.find((s) => s.active);
  if (!active) return null;
  const over = entry.overForecastMinutes;
  return (
    <>
      <dt className="text-muted-foreground">Actual</dt>
      <dd className={cn(over !== undefined && "font-medium text-danger")}>
        {minutesText((Date.parse(active.end) - Date.parse(active.start)) / 60_000)} so far{over !== undefined && `, ${minutesText(over)} over`}
      </dd>
    </>
  );
}

/**
 * A task's size, the forecast or manual estimate its bar uses, and while a run is active how long it has
 * gone against that, in the bar's hover card.
 */
function DurationRows({ task, entry, ctx }: { task: PlanTask; entry: TimelineItem; ctx: CardContext }) {
  const { forecasts, capacity } = ctx.move;
  if (!forecasts || capacity === undefined) return null;
  const duration = durationIn(ctx.move, task);
  const size = task.size ?? task.proposal?.size;
  return (
    <>
      <dt className="text-muted-foreground">Size</dt>
      <dd>{task.size ?? (task.proposal ? `${task.proposal.size}, proposed by the planner` : "Not set")}</dd>
      {size !== undefined && <ForecastRow forecast={forecasts[size]} capacity={capacity} />}
      {duration?.source === "estimate" && (
        <>
          <dt className="text-muted-foreground">Estimate</dt>
          <dd>{hoursInWords(duration.hours)}, manual</dd>
        </>
      )}
      {duration && <ActualRow entry={entry} />}
    </>
  );
}

/** When each run of a task ran, by the clock, newest first. */
function RunTimes({ entry }: { entry: TimelineItem }) {
  if (entry.actual.length === 0) return null;
  return (
    <>
      <dt className="text-muted-foreground">Runs</dt>
      <dd className="flex flex-col gap-0.5 tabular-nums">
        {entry.actual.map((strip) => (
          <span key={strip.runId}>{stripClock(strip)}</span>
        ))}
      </dd>
    </>
  );
}

/** A task's Target: the day its bar ends when its duration sets it, with GitHub's own Target when that differs. */
function TargetText({ item, entry }: { item: PlanItem; entry: TimelineItem }) {
  const span = entry.planned;
  if (span?.hours === undefined) return <>{item.target ? shortDay(item.target) : "Not set"}</>;
  return (
    <>
      {shortDay(span.end)} <span className="text-muted-foreground">from the {item.estimate !== undefined ? "estimate" : "forecast"}</span>
      {span.targetOnGitHub && <span className="block text-muted-foreground">Target on GitHub: {shortDay(span.targetOnGitHub)}</span>}
    </>
  );
}

/** A task's latest run, when its runs ran, and its pull request, in the bar's hover card. */
function TaskRunRows({ task, entry, projectId }: { task: PlanTask; entry: TimelineItem; projectId: string }) {
  const pr = prNumberOf(task);
  return (
    <>
      <dt className="text-muted-foreground">Latest run</dt>
      <dd>
        {task.run ? (
          <Link href={runPath(projectId, task.run.id)} className="rounded-full">
            <StatusBadge status={task.run.status} size="sm" />
          </Link>
        ) : (
          "None yet"
        )}
      </dd>
      <RunTimes entry={entry} />
      <dt className="text-muted-foreground">Pull request</dt>
      <dd>{pr !== undefined ? `#${pr}` : "None"}</dd>
    </>
  );
}

/** The hover card of a bar or a row title: kind, status, dates and where they come from, blockers, latest run and pull request. */
function ItemCard({ row, entry, ctx, quiet = false, children }: { row: TimelineRow; entry: TimelineItem; ctx: CardContext; quiet?: boolean; children: ReactNode }) {
  const item = row.item!;
  const task = row.task;
  const span = entry.planned ? "Own dates" : entry.derived ? "Derived from its tasks" : "Not scheduled";
  const progress = progressOf(item);
  // A bar on the move keeps its card shut; the drag's tooltip speaks for it.
  const [open, setOpen] = useState(false);
  return (
    <HoverCard openDelay={300} closeDelay={100} open={open && !quiet} onOpenChange={setOpen}>
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
          {task && <DurationRows task={task} entry={entry} ctx={ctx} />}
          <dt className="text-muted-foreground">Start</dt>
          <dd>{item.start ? shortDay(item.start) : "Not set"}</dd>
          <dt className="text-muted-foreground">Target</dt>
          <dd>
            <TargetText item={item} entry={entry} />
          </dd>
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
          {task && <TaskRunRows task={task} entry={entry} projectId={ctx.projectId} />}
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

/** The drag's tooltip under the bar: the day, the duration with its Target, and the blockers it starts before. */
type Tip = { title: string; line: string; warnings: string[] };

/** How a task's bar moves: its handlers, its end handle, and while it moves where it was and what the tooltip says. */
type BarMove = {
  bar: Partial<ReturnType<ReturnType<typeof useBarDrag>["barProps"]>>;
  end: ReturnType<ReturnType<typeof useBarDrag>["endProps"]> | undefined;
  origin: { left: number; width: number } | undefined;
  tip: Tip | undefined;
  onFocus: () => void;
};

/** A task's size and duration in words for its bar's name: "size M, forecast 50 minutes", "manual estimate 9 hours". */
function durationName(task: PlanTask, ctx: CardContext): string {
  const duration = durationIn(ctx.move, task);
  if (!duration) return "";
  const size = task.size ? `size ${task.size}, ` : "";
  switch (duration.source) {
    case "estimate":
      return `, ${size}manual estimate ${hoursInWords(duration.hours)}`;
    case "proposal":
      return `, size ${task.proposal?.size} proposed by the planner, forecast ${durationInWords(duration.hours)}`;
    default:
      return `, ${size}${duration.source === "default" ? "default forecast" : "forecast"} ${durationInWords(duration.hours)}`;
  }
}

/** The bar's text: a sized bar's duration ("1.5d", "~2h"), or the title on a wide bar without one. */
function barText(task: PlanTask, ctx: CardContext, width: number): string | undefined {
  const duration = durationIn(ctx.move, task);
  if (duration && ctx.move.capacity !== undefined) return width >= 28 ? `${duration.source === "estimate" ? "" : "~"}${formatDuration(duration.hours, ctx.move.capacity)}` : undefined;
  return width > TITLE_INSIDE ? task.title : undefined;
}

/** A task bar's look: its status colour, a forecast's fade, a red edge when late or early, and the grab of a bar that moves. */
function taskBarClass(column: PlanColumn, entry: TimelineItem, duration: Duration | undefined, move: BarMove | undefined) {
  return cn(
    "absolute top-1.5 z-[2] flex h-5 min-w-1 items-center overflow-hidden rounded-[5px] border-2 px-1.5 text-[11px] font-medium whitespace-nowrap text-foreground",
    FOCUS,
    BAR_TONE[column],
    openEdges(entry),
    duration && "justify-center px-0.5",
    duration && duration.source !== "estimate" && "[border-right-style:dotted] [mask-image:linear-gradient(90deg,#000_55%,rgb(0_0_0/0.45))]",
    (entry.late || entry.startsBeforeBlocker.length > 0) && "border-l-[4px] border-l-danger-dot",
    move && "cursor-grab touch-none select-none hover:ring-1 hover:ring-foreground/60",
    move?.tip && "z-[7] cursor-grabbing shadow-lg ring-1 ring-foreground/60",
  );
}

/**
 * A task's bar in its status colour, with a red left edge when late or when it starts before a blocker ends,
 * and a hatched tail to today when overdue. A forecast fades at its end; a manual estimate is solid. A bar
 * that moves drags by its body and, with a duration, sets a manual estimate by its end.
 */
function TaskBar({ row, entry, span, scale, todayX, ctx, move, previewed }: BarProps & { todayX: number; move: BarMove | undefined; previewed: boolean }) {
  const task = row.task!;
  const column = taskColumn(task);
  const { left, width } = barBox(scale, span, ctx.move.capacity);
  const blocked = entry.waitingOn.length ? `, blocked by ${entry.waitingOn.map((n) => `#${n}`).join(", ")}` : "";
  const overdue = entry.overdueDays !== undefined && todayX > left + width && !move?.tip;
  const early = entry.startsBeforeBlocker.length > 0;
  const text = barText(task, ctx, width);
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
      {move?.origin && <span aria-hidden data-ghost className="absolute top-1.5 z-[1] h-5 rounded-[5px] border-[1.5px] border-dashed border-muted-foreground bg-foreground/5" style={move.origin} />}
      <ItemCard row={row} entry={entry} ctx={ctx} quiet={move?.tip !== undefined}>
        <a
          href={task.url}
          data-bar
          data-column={column}
          data-late={entry.late}
          data-early={early || undefined}
          data-preview={previewed || undefined}
          aria-label={`Task #${task.number} ${task.title}, ${column}${durationName(task, ctx)}, ${spanText(span)}${blocked}${previewed ? ", in preview" : ""}`}
          aria-keyshortcuts={move ? "ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight E Escape" : undefined}
          {...move?.bar}
          onFocus={move?.onFocus}
          className={cn(taskBarClass(column, entry, durationIn(ctx.move, task), move), previewed && "border-dashed border-active-dot bg-active-bg")}
          style={{ left, width }}
        >
          {text && <span className="truncate">{text}</span>}
          {move?.end && width >= 12 && <span aria-hidden data-end {...move.end} className="absolute inset-y-0.5 right-px w-1 cursor-ew-resize rounded-[2px] bg-foreground/45" />}
        </a>
      </ItemCard>
      {move?.tip && <DragTip tip={move.tip} left={left} />}
    </>
  );
}

/** What a drag says while it moves: the day it lands on, the Target that follows, and a warning when it starts before a blocker ends. */
function DragTip({ tip, left }: { tip: Tip; left: number }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-7 z-[12] flex flex-col gap-0.5 rounded-md border bg-popover px-2.5 py-1.5 text-[11.5px] leading-snug whitespace-nowrap text-muted-foreground shadow-md"
      style={{ left: Math.max(0, left) + 6 }}
    >
      <b className="font-semibold text-foreground">{tip.title}</b>
      {tip.line && <span>{tip.line}</span>}
      {tip.warnings.map((w) => (
        <span key={w} className="mt-0.5 flex items-center gap-1.5 font-medium text-danger">
          <TriangleAlertIcon aria-hidden className="size-3" />
          {w}
        </span>
      ))}
    </div>
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
function PlannedBar({ move, previewed, ...props }: Omit<BarProps, "span"> & { todayX: number; move: BarMove | undefined; previewed: boolean | undefined }) {
  const span = props.entry.planned ?? props.entry.derived;
  if (!span) return null;
  return props.row.task ? <TaskBar {...props} span={span} move={move} previewed={previewed ?? false} /> : <SpanBar {...props} span={span} />;
}

/** Where a sized task's strips start and their scale: under its bar, an hour as wide as the bar's hours. */
type StripScale = { left: number; hourWidth: number; hours: number };

const HOUR_MS = 60 * 60 * 1000;

/**
 * One strip per run that linked the task, newest at the top, each opening its run. Under a sized bar every
 * strip starts at the bar's left edge at the bar's scale, and what runs past the duration is a red overrun;
 * otherwise a strip sits at its clock time.
 */
function Strips({ row, entry, scale, projectId, under }: { row: TimelineRow; entry: TimelineItem; scale: TimeScale; projectId: string; under: StripScale | undefined }) {
  const item = row.item!;
  return entry.actual.map((strip, i) => {
    const hours = (Date.parse(strip.end) - Date.parse(strip.start)) / HOUR_MS;
    const left = under ? under.left : scale.xAt(strip.start);
    const full = under ? hours * under.hourWidth : scale.xAt(strip.end) - left;
    const width = Math.max(2, under ? Math.min(hours, under.hours) * under.hourWidth : full);
    const overrun = under && hours > under.hours ? (hours - under.hours) * under.hourWidth : 0;
    const short = strip.runId.slice(0, 8);
    return (
      <Fragment key={strip.runId}>
        <Link
          href={runPath(projectId, strip.runId)}
          data-bar
          aria-label={`Run ${short} of #${item.number} ${item.title}, ${strip.status}, ${stripDates(strip)}`}
          title={`#${item.number} ${item.title}, ${strip.status}, ${stripClock(strip)}`}
          className={cn("absolute z-[2] h-1.5 rounded-[2px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", overrun > 0 && "rounded-r-none", STRIP_TONE[statusTone(strip.status)])}
          style={{ left, width, top: stripTop(i) }}
        />
        {overrun > 0 && (
          <span
            aria-hidden
            data-bar
            data-overrun
            className="absolute z-[2] h-1.5 rounded-r-[2px] bg-[repeating-linear-gradient(135deg,var(--danger-dot)_0_3px,color-mix(in_oklab,var(--danger-dot)_35%,transparent)_3px_6px)]"
            style={{ left: left + width, width: overrun, top: stripTop(i) }}
          />
        )}
        {full > ID_BESIDE && scale.zoom === "weeks" && !under && (
          <span aria-hidden data-bar className="absolute z-[2] font-mono text-[9.5px] leading-[10px] whitespace-nowrap text-muted-foreground" style={{ left: left + full + 4, top: stripTop(i) - 2 }}>
            {short}
          </span>
        )}
      </Fragment>
    );
  });
}

type RowLabelProps = {
  row: TimelineRow;
  entry: TimelineItem | undefined;
  projectId: string;
  start: StartRunContext;
  flags: FlagContext;
  onToggle: () => void;
  onSchedule: (item: PlanItem) => void;
  /** The size popover is open, as E on the task's focused bar asks. */
  sizeOpen: boolean;
  onSizeOpenChange: (open: boolean) => void;
  /** Where an Arrange preview puts the task. */
  preview: DaySpan | undefined;
};

/** A task's menu with the moves its status allows and Schedule; an epic's or a story's with Open on GitHub and Schedule. */
function RowMenu({ row, projectId, start, onSchedule }: Pick<RowLabelProps, "row" | "projectId" | "start" | "onSchedule">) {
  const { item, task } = row;
  if (task) return <TaskActions task={task} projectId={projectId} start={start} compact onSchedule={() => onSchedule(task)} />;
  return item ? <ItemMenu item={item} onSchedule={() => onSchedule(item)} /> : null;
}

/** A Timeline row's left cell: a task's warning icon beside its title, a sum on an epic or a story, and a task's size chip under it. */
function TimelineRowLabel({ row, entry, projectId, start, flags, onToggle, onSchedule, sizeOpen, onSizeOpenChange, preview }: RowLabelProps) {
  const { item, task } = row;
  const sizing = use(Sizing);
  return (
    <RowLabel
      row={row}
      onToggle={onToggle}
      flag={task && entry && <FlagCard task={task} entry={entry} ctx={flags} />}
      aside={!task && item && <SizeSum tasks={tasksOf(item)} />}
      menu={<RowMenu row={row} projectId={projectId} start={start} onSchedule={onSchedule} />}
      below={
        task &&
        sizing && (
          <div className="flex min-w-0 items-center justify-end gap-1.5 pr-7">
            {preview && (
              <Tag tone="active">
                <CalendarRangeIcon aria-hidden />
                {spanText(preview)}
              </Tag>
            )}
            <SizeChip task={task} open={sizeOpen} onOpenChange={onSizeOpenChange} />
          </div>
        )
      }
    />
  );
}

type UnscheduledGroup = { title: string; items: PlanItem[] };

/** What the Unscheduled block needs to drag a task onto the chart: its grip's handlers, and the task on the move. */
type Placing = { grip: (task: PlanTask) => ReturnType<ReturnType<typeof useBarDrag>["gripProps"]> | undefined; issue: number | undefined; enabled: boolean };

/**
 * An unscheduled task's grip: with a duration it drags the task onto the chart; without one it is off and
 * says why. Done and Running tasks have none, and nothing has one without the Plan page's sizes.
 */
function Grip({ task, placing }: { task: PlanTask; placing: Placing }) {
  if (!placing.enabled || !canMove(task)) return null;
  const props = placing.grip(task);
  const GRIP = "-ml-6 grid h-[22px] w-[18px] shrink-0 place-items-center rounded-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-3.5";
  if (!props) {
    const why = `Set a size or an estimate to drag #${task.number} onto the chart`;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-disabled="true" aria-label={why} className={cn(GRIP, "cursor-not-allowed opacity-45")}>
            <GripVerticalIcon aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <button type="button" aria-label={`Drag #${task.number} onto the chart`} title="Drag onto the chart" className={cn(GRIP, "cursor-grab touch-none hover:bg-muted hover:text-foreground")} {...props}>
      <GripVerticalIcon aria-hidden />
    </button>
  );
}

/**
 * Items with neither dates nor a derived span, grouped by epic, each with a Schedule button. Its header offers
 * Arrange by estimate; while the preview shows, the tasks it places are tagged In preview and the ones it
 * leaves out Needs a size.
 */
function Unscheduled({ groups, undated, onSchedule, placing, arrange }: { groups: UnscheduledGroup[]; undated: boolean; onSchedule: (item: PlanItem) => void; placing: Placing; arrange: ArrangeControl }) {
  const [open, setOpen] = useState(true);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  if (count === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section aria-label="Unscheduled" className="border-t">
        <div className="flex items-center gap-2 bg-muted/50 pr-3.5 hover:bg-muted">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 px-3.5 py-2.5 text-left text-[13px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
            <ChevronRightIcon aria-hidden className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
            <span className="font-medium">Unscheduled</span>
            <Tag tone="fill">{count}</Tag>
            <span className="truncate text-xs text-muted-foreground">No Start and no Target</span>
          </CollapsibleTrigger>
          <ArrangeButton arrange={arrange} />
        </div>
        <CollapsibleContent>
          {undated && <p className="px-3.5 pt-1 pb-2.5 pl-[38px] text-[13px] text-muted-foreground">Give tasks a Start and Target to see them on the timeline, or ask the assistant to schedule an epic.</p>}
          {groups.map((group) => (
            <div key={group.title}>
              <p className="px-3.5 pt-2 pb-0.5 pl-[38px] text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group.title}</p>
              <ul>
                {group.items.map((item) => {
                  const kind = item.kind ?? "task";
                  return (
                    <li
                      key={item.number}
                      aria-label={`${KIND_NAME[kind]} #${item.number} ${item.title}`}
                      data-placing={placing.issue === item.number || undefined}
                      className="flex min-w-0 items-center gap-2 border-t px-3.5 py-1.5 pl-[38px] data-placing:bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--foreground)_4%,transparent)_0_6px,transparent_6px_12px)]"
                    >
                      {kind === "task" && <Grip task={item as PlanTask} placing={placing} />}
                      <KindBadge kind={kind} />
                      <IssueTitle item={item} className="text-xs" />
                      {kind === "task" && <StatusPill column={item.state === "closed" ? "Done" : (item.status ?? "Other")} />}
                      {placing.issue === item.number && <Tag tone="outline">Placing</Tag>}
                      {arrange.preview?.bars.has(item.number) && <Tag tone="active">In preview</Tag>}
                      {arrange.preview?.leftOut.some((l) => l.issue === item.number) && <Tag tone="outline">Needs a size</Tag>}
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        {kind === "task" && <SizeChip task={item as PlanTask} />}
                        <Button size="xs" variant="outline" aria-label={`Schedule #${item.number} ${item.title}`} onClick={() => onSchedule(item)}>
                          <CalendarIcon data-icon="inline-start" />
                          Schedule
                        </Button>
                      </span>
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

/** The keys of a focused bar that moves, under the chart. */
function KeyHint({ issue, sized }: { issue: number; sized: boolean }) {
  return (
    <div role="group" aria-label={`Keys for bar #${issue}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-3.5 py-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        <KeyboardIcon aria-hidden className="size-3.5" />
        Bar #{issue}
      </span>
      <span className="flex items-center gap-1.5">
        <KbdGroup>
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
        </KbdGroup>
        Move a day
      </span>
      {sized && (
        <>
          <span className="flex items-center gap-1.5">
            <KbdGroup>
              <Kbd>⇧</Kbd>
              <Kbd>←</Kbd>
              <Kbd>→</Kbd>
            </KbdGroup>
            Manual estimate one hour less or more
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>E</Kbd>
            Size and estimate
          </span>
        </>
      )}
      <span className="flex items-center gap-1.5">
        <Kbd>Enter</Kbd>
        Open on GitHub
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>Esc</Kbd>
        Put it back
      </span>
    </div>
  );
}

/** The part of the time pane in view, for the marker that points to today when it is out of view. */
type PaneView = { left: number; width: number };

const NO_MOVES: ReadonlyMap<number, MovePlan> = new Map();

/** A task with a saved move's Start, Target and estimate, as GitHub will have them. */
function movedTask<T extends PlanItem>(task: T, plan: MovePlan | undefined): T {
  if (!plan) return task;
  return { ...task, start: plan.start ?? undefined, target: plan.target ?? undefined, ...(plan.estimate !== undefined ? { estimate: plan.estimate ?? undefined } : {}) };
}

/** The plan with the saved moves applied to its tasks, until the next read from GitHub brings them. */
function movedPlan(epics: PlanEpic[], unparented: PlanTask[], moves: ReadonlyMap<number, MovePlan>) {
  if (moves.size === 0) return { epics, unparented };
  const task = (t: PlanTask) => movedTask(t, moves.get(t.number));
  return {
    epics: epics.map((e) => ({ ...e, tasks: e.tasks.map(task), stories: e.stories.map((s) => ({ ...s, tasks: s.tasks.map(task) })) })),
    unparented: unparented.map(task),
  };
}

/** An item's place in time after a move: its new bar, and the blockers it starts before. */
const movedEntry = (entry: TimelineItem, plan: MovePlan): TimelineItem => ({
  ...entry,
  planned: plan.span,
  unscheduled: !plan.span && !entry.derived,
  startsBeforeBlocker: plan.startsBefore.map((b) => b.number),
});

/** Every item's place in time with the saved moves applied. */
function movedEntries(timeline: Timeline, moves: ReadonlyMap<number, MovePlan>): Map<number, TimelineItem> {
  return new Map(timeline.items.map((i) => [i.number, moves.has(i.number) ? movedEntry(i, moves.get(i.number)!) : i]));
}

/**
 * The load row's hours per day from every bar with a duration, the ones the filters hide too, and a note on
 * the tasks shown with dates that add nothing for want of a size.
 */
function loadOf(entries: ReadonlyMap<number, TimelineItem>, items: ReadonlyMap<number, PlanItem>, capacity: number) {
  const hours = hoursByDay([...entries.values()].map((e) => e.planned), capacity);
  const unsized = [...items.values()].filter((i) => i.kind === "task" && entries.get(i.number)?.planned && entries.get(i.number)?.planned?.hours === undefined).length;
  const note = unsized === 0 ? undefined : `${unsized === 1 ? "1 task with dates has" : `${unsized} tasks with dates have`} no size, so ${unsized === 1 ? "its" : "their"} hours are not counted`;
  return { hours, capacity, note };
}

const numbers = (list: readonly { number: number }[]) => list.map((b) => `#${b.number}`).join(" and ");

/** The toast after a saved move: what moved, with the estimate it set and the blockers it starts before. */
function savedText(task: PlanTask, plan: MovePlan, capacity: number | undefined): { title: string; description: string } {
  const n = task.number;
  const hours = typeof plan.estimate === "number" ? formatDuration(plan.estimate, capacity ?? Infinity) : undefined;
  const early = plan.startsBefore.length ? ` It starts before ${numbers(plan.startsBefore)} ends.` : "";
  if (plan.start === (task.start ?? null) && plan.estimate !== undefined) {
    return hours
      ? { title: `#${n} has a manual estimate of ${hours}`, description: `Saved to GitHub.${task.size ? ` Its size stays ${task.size}.` : ""}${early}` }
      : { title: `#${n} uses the forecast again`, description: "Saved to GitHub. The Estimate field is cleared." };
  }
  if (!plan.start) return { title: `#${n} is unscheduled again`, description: "Saved to GitHub. Start and Target are cleared." };
  return { title: `Moved #${n} to ${shortDay(plan.start)}`, description: `Saved to GitHub.${hours ? ` Manual estimate ${hours}.` : ""}${early}` };
}

const where = (start: string | null) => (start ? `on ${shortDay(start)}` : "in Unscheduled");

/**
 * The timeline's writes: a drop, the keys' move and their Undo each write at once, with a saving toast, then
 * one that names the change with Undo, or one that says GitHub refused it with Try again. The bar shows where
 * it was dropped until the next read from GitHub, and goes back when the write is refused.
 */
function useMoves(projectId: string, timeline: Timeline) {
  const router = useRouter();
  const sizing = use(Sizing);
  const [state, setState] = useState<{ timeline: Timeline; moves: ReadonlyMap<number, MovePlan> }>({ timeline, moves: NO_MOVES });
  const moves = state.timeline === timeline ? state.moves : NO_MOVES;

  /** Shows each task where its plan puts it, or where GitHub has it for undefined. */
  const putAll = (plans: ReadonlyMap<number, MovePlan | undefined>) =>
    setState((s) => {
      const next = new Map(s.timeline === timeline ? s.moves : NO_MOVES);
      for (const [issue, plan] of plans) {
        if (plan) next.set(issue, plan);
        else next.delete(issue);
      }
      return { timeline, moves: next };
    });
  const put = (issue: number, plan: MovePlan | undefined) => putAll(new Map([[issue, plan]]));

  /** Writes a move of `task`, whose bar is `entry` before it; `undo` marks the write that puts it back. */
  const save = (task: PlanTask, entry: TimelineItem | undefined, plan: MovePlan, undo = false) => {
    const n = task.number;
    const was = moves.get(n);
    const back = moveBack(task, entry, plan);
    const estimate = typeof plan.estimate === "number" ? `, manual estimate ${formatDuration(plan.estimate, sizing?.capacity ?? Infinity)}` : "";
    const dates = plan.start ? `Start ${shortDay(plan.start)}, Target ${shortDay(plan.target ?? plan.start)}${estimate}` : "Start and Target cleared";
    const id = toast.loading(`Saving #${n} to GitHub`, { description: dates });
    put(n, plan);
    startTransition(async () => {
      const result = await moveItemAction({ projectId, issue: n, start: plan.start, target: plan.target, ...(plan.estimate !== undefined ? { estimate: plan.estimate } : {}) });
      if (result.ok) {
        const moved = movedTask(task, plan);
        const text = undo ? { title: plan.start ? `Put #${n} back ${where(plan.start)}` : `#${n} is unscheduled again`, description: "Saved to GitHub." } : savedText(task, plan, sizing?.capacity);
        toast.success(text.title, { id, description: text.description, ...(undo ? {} : { action: { label: "Undo", onClick: () => save(moved, entry && movedEntry(entry, plan), back, true) } }) });
        startTransition(() => router.refresh());
        return;
      }
      put(n, was);
      toast.error("GitHub did not take the date", {
        id,
        description: `#${n} is back ${where(back.start)}.${result.error ? ` ${result.error}` : ""}`,
        action: { label: "Try again", onClick: () => save(task, entry, plan, undo) },
      });
    });
  };

  /**
   * Writes the Start and Target of every task an Arrange preview placed, in one save. The bars stay where the
   * preview put them; a task GitHub refuses goes back to Unscheduled and the toast names it with why.
   */
  const saveArranged = (placed: { issue: number; plan: MovePlan }[]) => {
    const was = new Map(placed.map(({ issue }) => [issue, moves.get(issue)]));
    const where = placed.map(({ issue, plan }) => `#${issue} on ${shortDay(plan.start!)}`).join(", ");
    const id = toast.loading(`Saving ${tasksText(placed.length)} to GitHub`, { description: where });
    putAll(new Map(placed.map(({ issue, plan }) => [issue, plan])));
    startTransition(async () => {
      const result = await saveArrangeAction({ projectId, items: placed.map(({ issue, plan }) => ({ issue, start: plan.start!, target: plan.target! })) });
      if (!result.ok) {
        putAll(was);
        toast.error("GitHub did not take the dates", { id, description: `${result.error} The tasks stay unscheduled.`, action: { label: "Try again", onClick: () => saveArranged(placed) } });
        return;
      }
      startTransition(() => router.refresh());
      if (result.refused.length === 0) {
        toast.success(`Arranged ${tasksText(result.saved.length)}`, { id, description: "Saved Start and Target to GitHub." });
        return;
      }
      putAll(new Map(result.refused.map(({ issue }) => [issue, was.get(issue)])));
      const reasons = result.refused.map((r) => `#${r.issue}: ${r.reason}.`).join(" ");
      const saved = result.saved.length ? ` ${result.saved.map((n) => `#${n}`).join(" and ")} ${result.saved.length === 1 ? "is" : "are"} saved.` : "";
      toast.error(`GitHub did not take ${result.refused.map((r) => `#${r.issue}`).join(" and ")}`, { id, description: `${reasons}${saved}` });
    });
  };
  return { moves, save, saveArranged };
}

const tasksText = (n: number) => (n === 1 ? "1 task" : `${n} tasks`);

type ChartArrow = ReturnType<typeof chartArrows>[number];

/** The dependency arrows over the rows; hovering a row keeps its arrows strong and dims the rest. */
function ArrowLayer({ arrows, width, height, hovered }: { arrows: ChartArrow[]; width: number; height: number; hovered: number | undefined }) {
  const touches = (a: ChartArrow) => hovered !== undefined && (a.from === hovered || a.to === hovered);
  return (
    <svg className="absolute inset-0 z-[1] overflow-visible" width={width} height={height}>
      {arrows.map((a) => (
        <g
          key={`${a.from}-${a.to}`}
          data-arrow={`${a.from}-${a.to}`}
          data-late={a.late}
          data-early={a.early}
          className={cn(a.red ? "text-danger-dot" : "text-muted-foreground", hovered !== undefined && (touches(a) ? !a.red && "text-foreground" : "opacity-25"))}
        >
          <path d={a.d} fill="none" stroke="currentColor" strokeWidth={touches(a) ? 2.25 : a.red ? 1.75 : 1.25} />
          <path d={`M${a.end.left} ${a.end.y} l-5 -3.5 v7 z`} fill="currentColor" />
          {!a.start.own && <circle cx={a.start.right} cy={a.start.y} r={2.5} fill="currentColor" />}
        </g>
      ))}
    </svg>
  );
}

/** The marker that points to today when it is out of view, scrolling back to it. */
function TodayMarker({ side, today, onClick }: { side: "left" | "right"; today: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute top-[25px] z-20 inline-flex h-[22px] items-center gap-1 rounded-full bg-foreground px-2 text-[11px] font-semibold text-background shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        side === "right" && "right-2",
      )}
      style={side === "left" ? { left: LABEL_WIDTH + 6 } : undefined}
    >
      {side === "left" && <ArrowLeftIcon aria-hidden className="size-3" />}
      Today, {shortDay(today)}
      {side === "right" && <ArrowRightIcon aria-hidden className="size-3" />}
    </button>
  );
}

/**
 * The time axis: months over days or weeks, Today, and under them the load row when the plan has sizes. The
 * load row's label opens the capacity popover.
 */
function TimeAxis({
  projectId,
  scale,
  todayX,
  load,
}: {
  projectId: string;
  scale: TimeScale;
  todayX: number;
  load: (ReturnType<typeof loadOf> & { preview: Record<string, number> | undefined }) | undefined;
}) {
  return (
    <div role="row" aria-label="Time axis" className={cn("flex", load ? "h-[66px]" : "h-12")}>
      <div role="columnheader" className="sticky left-0 z-10 border-r border-b bg-card" style={{ width: LABEL_WIDTH }}>
        <span className="absolute top-[26px] left-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Item</span>
        {load && (
          <CapacityPopover projectId={projectId} capacity={load.capacity}>
            <button
              type="button"
              title={load.note}
              className="absolute inset-x-0 bottom-0 flex h-[18px] items-center justify-end border-t px-2.5 text-[10.5px] font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Load at {formatDuration(load.capacity, Infinity)} a day
            </button>
          </CapacityPopover>
        )}
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
        {load && <LoadRow scale={scale} hours={load.hours} capacity={load.capacity} preview={load.preview} />}
      </div>
    </div>
  );
}

/**
 * The dependency arrows between the rows on the chart, from each blocker's bar or strips to the blocked
 * item's, red when the blocked item is late or starts before its blocker ends.
 */
function chartArrows(timeline: Timeline, entries: ReadonlyMap<number, TimelineItem>, anchor: Parameters<typeof placeItem>[1], scale: TimeScale, capacity: number | undefined) {
  const barOf = (n: number) => {
    const span = entries.get(n)?.planned ?? entries.get(n)?.derived;
    if (!span) return undefined;
    const { left, width } = barBox(scale, span, capacity);
    return { left, right: left + width };
  };
  const stripsOf = (n: number) => {
    const actual = entries.get(n)?.actual ?? [];
    if (actual.length === 0) return undefined;
    return { left: Math.min(...actual.map((a) => scale.xAt(a.start))), right: Math.max(...actual.map((a) => scale.xAt(a.end))) };
  };
  const early = new Set([...entries.values()].flatMap((e) => e.startsBeforeBlocker.map((b) => `${b}-${e.number}`)));
  const arrows = timeline.arrows.flatMap((arrow) => {
    const from = placeItem(arrow.from, anchor, barOf, stripsOf);
    const to = placeItem(arrow.to, anchor, barOf, stripsOf);
    if (!from || !to || (from.row === to.row && !from.own)) return [];
    // Red when the blocked item is late, or starts before its blocker ends.
    const before = early.has(`${arrow.from}-${arrow.to}`);
    return [{ ...arrow, early: before, red: arrow.late || before, start: from, end: to, d: arrowPath(from, to) }];
  });
  return arrows;
}

/** The items with neither dates nor a derived span, grouped by epic, with the unparented tasks last. */
function unscheduledGroups(epics: PlanEpic[], unparented: PlanTask[], entries: ReadonlyMap<number, TimelineItem>): UnscheduledGroup[] {
  return [...epics.map((e) => ({ title: e.title, items: [e, ...e.stories.flatMap((s) => [s, ...s.tasks]), ...e.tasks] })), { title: "Unparented", items: unparented }]
    .map((g) => ({ ...g, items: g.items.filter((i) => entries.get(i.number)?.unscheduled) }))
    .filter((g) => g.items.length > 0);
}

/** The unscheduled tasks in view that a person may place: not Done, and no run owns them. */
function unscheduledTasks(epics: PlanEpic[], unparented: PlanTask[], entries: ReadonlyMap<number, TimelineItem>): PlanTask[] {
  return unscheduledGroups(epics, unparented, entries)
    .flatMap((g) => g.items)
    .flatMap((i) => ((i.kind ?? "task") === "task" && canMove(i as PlanTask) ? [i as PlanTask] : []));
}

/** What the chart's moves need: the plan as shown, the scale, and the grid for where a pointer is. */
type ChartMovesInput = { projectId: string; timeline: Timeline; planEpics: PlanEpic[]; planUnparented: PlanTask[]; scale: TimeScale; grid: RefObject<HTMLDivElement | null> };

/**
 * The chart's moving parts: the plan with its saved moves, every item's place with the move in progress,
 * how each bar moves, the Unscheduled grips, and the focused bar and the size popover its E opens.
 */
function useChartMoves({ projectId, timeline, planEpics, planUnparented, scale, grid }: ChartMovesInput) {
  const sizing = use(Sizing);
  const [focused, setFocused] = useState<number>();
  const [sizeOpen, setSizeOpen] = useState<number>();
  const [arranging, setArranging] = useState(false);
  const { moves, save, saveArranged } = useMoves(projectId, timeline);
  const { epics, unparented } = useMemo(() => movedPlan(planEpics, planUnparented, moves), [planEpics, planUnparented, moves]);
  const saved = useMemo(() => movedEntries(timeline, moves), [timeline, moves]);
  const items = useMemo(() => itemsOf(epics, unparented), [epics, unparented]);
  const move: MoveContext = { capacity: sizing?.capacity, forecasts: sizing?.forecasts, items, entries: saved };

  // Arrange by estimate places the unscheduled tasks in view; its preview shows on the chart until Save or Cancel.
  const arrangeable = sizing ? unscheduledTasks(epics, unparented, saved).map((t) => ({ number: t.number, hours: durationIn(move, t)?.hours })) : [];
  const computed = sizing && arranging ? arrangeTimeline(arrangeable, { items: [...saved.values()], arrows: timeline.arrows }, sizing.capacity, timeline.today) : undefined;
  const preview = computed?.placements.length ? computed : undefined;
  const previewPlans = new Map(preview?.placements.map((p): [number, MovePlan] => [p.issue, { start: p.start, target: p.target, span: preview.bars.get(p.issue), startsBefore: [] }]));
  const shown = preview ? new Map([...saved].map(([n, e]) => [n, previewPlans.has(n) ? movedEntry(e, previewPlans.get(n)!) : e])) : saved;
  const arrange: ArrangeControl = {
    enabled: sizing !== undefined,
    possible: arrangeable.some((t) => t.hours !== undefined),
    preview,
    previewHours: preview && sizing ? hoursByDay(preview.bars.values(), sizing.capacity) : undefined,
    start: () => setArranging(true),
    cancel: () => setArranging(false),
    save: () => {
      setArranging(false);
      if (preview) saveArranged(preview.placements.map((p) => ({ issue: p.issue, plan: previewPlans.get(p.issue)! })));
    },
  };

  const { drag, barProps, endProps, gripProps } = useBarDrag({
    onDrop: (done) => {
      const task = items.get(done.issue) as PlanTask | undefined;
      const plan = task && planMove(move, task, done);
      if (task && plan) save(task, saved.get(task.number), plan);
    },
    onSize: setSizeOpen,
  });
  const dragged = drag && (items.get(drag.issue) as PlanTask | undefined);
  const draft = dragged ? planMove(move, dragged, drag) : undefined;
  const withDraft = (base: Map<number, TimelineItem>) => (draft && dragged ? new Map(base).set(dragged.number, movedEntry(base.get(dragged.number)!, draft)) : base);
  // The chart shows the preview; Unscheduled keeps listing the tasks in it until they are saved.
  const entries = withDraft(shown);
  const listed = withDraft(saved);

  /** How a task's bar moves: not at all when Done or Running, in the preview, or when it has no dates and no duration. */
  const moveOf = (task: PlanTask, entry: TimelineItem): BarMove | undefined => {
    const span = entry.planned;
    if (!span || !canMove(task) || previewPlans.has(task.number)) return undefined;
    const hours = sizing && span.hours !== undefined ? span.hours : undefined;
    const dayWidth = dayWidthAt(scale, span.start);
    const bar: DragBar = { issue: task.number, dayWidth, hourWidth: sizing ? dayWidth / sizing.capacity : dayWidth, hours };
    const moving = drag?.issue === task.number && draft && dragged ? draft : undefined;
    const before = saved.get(task.number)?.planned;
    const props = barProps(bar);
    return {
      bar: {
        ...props,
        onBlur: () => {
          props.onBlur();
          setFocused(undefined);
        },
      },
      end: hours !== undefined ? endProps(bar) : undefined,
      origin: moving && before ? barBox(scale, before, sizing?.capacity) : undefined,
      tip: moving && dragged ? moveTip(move, dragged, drag!, moving, drag!.via) : undefined,
      onFocus: () => setFocused(task.number),
    };
  };

  /** The day under a point of the screen when it is over the chart's time pane. */
  const dayUnder = (x: number, y: number) => {
    const box = grid.current?.getBoundingClientRect();
    if (!box || y < box.top || y > box.bottom) return undefined;
    return dayAt(scale, x - box.left - LABEL_WIDTH);
  };
  const placing: Placing = {
    enabled: sizing !== undefined,
    // Only an unscheduled task moves without a bar.
    issue: drag && !saved.get(drag.issue)?.planned ? drag.issue : undefined,
    grip: (task) => (durationIn(move, task) ? gripProps(task.number, dayUnder) : undefined),
  };

  return { epics, unparented, items, saved, entries, listed, move, moveOf, placing, arrange, focused, sizeOpen, setSizeOpen };
}

/**
 * The plan as a Gantt chart: a fixed column of row labels in the tree's order and a time pane that
 * scrolls sideways, with planned bars, run strips and dependency arrows. Hovering a row keeps its
 * arrows and the rows at their other ends strong and dims the rest.
 */
function TimelineChart({ projectId, project, epics: planEpics, unparented: planUnparented, timeline, zoom, readAt, graphs, graphName, needsYou, todayRef, searchOpen }: TimelineProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const rowsOpen = useRowsOpen(projectId, searchOpen);
  const q = useSearchQuery();
  const sizing = use(Sizing);
  const [scheduling, setScheduling] = useState<PlanItem>();
  const [hovered, setHovered] = useState<number>();
  const range = chartRange(timeline);
  const scale = timeScale(range, zoom ?? defaultZoom(range));
  const todayX = scale.xAt(new Date(readAt).toISOString());

  const { epics, unparented, items, saved, entries, listed, move, moveOf, placing, arrange, focused, sizeOpen, setSizeOpen } = useChartMoves({ projectId, timeline, planEpics, planUnparented, scale, grid });
  const ctx: CardContext = { items, entries, projectId, move };
  const flags: FlagContext = { projectId, items, entries, needsYou };

  const load = sizing && { ...loadOf(entries, items, sizing.capacity), preview: arrange.previewHours };
  /** A sized bar's strips start under it at its scale. */
  const stripScale = (entry: TimelineItem): StripScale | undefined => {
    const span = entry.planned;
    if (!sizing || span?.hours === undefined) return undefined;
    return { left: barBox(scale, span, sizing.capacity).left, hourWidth: hourWidthAt(scale, span.start, sizing.capacity), hours: span.hours };
  };

  const { rows, height, anchor } = timelineRows(epics, unparented, rowsOpen.isOpen, (n) => entries.get(n)?.actual.length ?? 0);

  const [pane, setPane] = useState<PaneView>();
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


  const arrows = chartArrows(timeline, entries, anchor, scale, sizing?.capacity);
  const touches = (a: (typeof arrows)[number]) => hovered !== undefined && (a.from === hovered || a.to === hovered);
  const related = new Set(hovered === undefined ? [] : [hovered, ...arrows.filter(touches).flatMap((a) => [a.from, a.to])]);

  const unscheduled = unscheduledGroups(epics, unparented, listed);

  const offscreen = pane && (todayX < pane.left ? "left" : todayX > pane.left + pane.width ? "right" : undefined);
  const fieldsGap = timelineFieldsGap(project);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {fieldsGap && <TimelineFieldsBanner projectId={projectId} project={project} gap={fieldsGap} />}
      {sizing && <ArrangeBanner arrange={arrange} capacity={sizing.capacity} />}
      <div className="relative">
        <div ref={scroller} className="overflow-x-auto overscroll-x-contain" onScroll={measure}>
          <div
            ref={grid}
            role="grid"
            aria-label="Timeline"
            aria-rowcount={rows.length + 1}
            data-scrolled={(pane?.left ?? 0) > 0}
            className="group/grid relative text-[13px]"
            style={{ width: LABEL_WIDTH + scale.width, minWidth: "100%" }}
          >
            <div role="rowgroup">
              <TimeAxis projectId={projectId} scale={scale} todayX={todayX} load={load} />
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
                    <TimelineRowLabel
                      row={row}
                      entry={entry}
                      projectId={projectId}
                      start={{ graphs, graphName }}
                      flags={flags}
                      onToggle={() => rowsOpen.toggle(row.key)}
                      onSchedule={setScheduling}
                      sizeOpen={row.task !== undefined && sizeOpen === row.task.number}
                      preview={row.task && arrange.preview?.bars.get(row.task.number)}
                      onSizeOpenChange={(open) => !open && setSizeOpen(undefined)}
                    />
                    <div role="gridcell" className={cn("relative flex-1 border-b", hovered !== undefined && !isRelated && "[&_[data-bar]]:opacity-35")} style={{ minWidth: scale.width }}>
                      {entry && <PlannedBar row={row} entry={entry} scale={scale} todayX={todayX} ctx={ctx} move={row.task && moveOf(row.task, entry)} previewed={row.task !== undefined && arrange.preview?.bars.has(row.task.number)} />}
                      {entry && row.task && <Strips row={row} entry={entry} scale={scale} projectId={projectId} under={stripScale(entry)} />}
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
                <ArrowLayer arrows={arrows} width={scale.width} height={height} hovered={hovered} />
                <span className="absolute inset-y-0 z-[3] w-0.5 -translate-x-1/2 bg-foreground/85" style={{ left: todayX }} />
              </div>
            </div>
          </div>
        </div>
        {offscreen && <TodayMarker side={offscreen} today={timeline.today} onClick={() => scrollToToday("smooth")} />}
      </div>
      {focused !== undefined && <KeyHint issue={focused} sized={!!sizing && saved.get(focused)?.planned?.hours !== undefined} />}
      <Unscheduled groups={unscheduled} undated={timeline.items.every((i) => !i.planned)} onSchedule={setScheduling} placing={placing} arrange={arrange} />
      <ScheduleDialog projectId={projectId} item={scheduling} notes={scheduling ? scheduleNotes(scheduling, items, entries) : []} onOpenChange={(open) => !open && setScheduling(undefined)} />
    </div>
  );
}

/** The Timeline view: the chart, or under 640 px the list form with dates as text. */
export function PlanTimeline(props: TimelineProps) {
  return useNarrow() ? <PlanTimelineList {...props} /> : <TimelineChart {...props} />;
}
