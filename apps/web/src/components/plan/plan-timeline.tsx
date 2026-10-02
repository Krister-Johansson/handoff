"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClockIcon, CalendarIcon, ChevronRightIcon, ClockAlertIcon, ExternalLinkIcon, LockIcon, MoreHorizontalIcon, MoveHorizontalIcon } from "lucide-react";
import type { PlanItem, PlanProject } from "@handoff/github";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlanColumn, PlanEpic, PlanProgress, PlanTask } from "@/server/plan";
import { Tag } from "@/components/tag";
import type { DaySpan, Timeline, TimelineItem } from "@/lib/plan/schedule";
import type { PlanFilters } from "@/lib/plan/filters";
import { taskColumn } from "@/lib/plan/task";
import { arrowPath, placeItem, timelineRows, type TimelineRow } from "@/lib/plan/timeline-rows";
import { addDays, dayOfInstant, defaultZoom, shortDay, timeScale, visibleRange, type TimeScale, type Zoom } from "@/lib/plan/timeline-scale";
import { runPath } from "@/lib/paths";
import { statusTone, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { TaskActions, type StartRunContext } from "./plan-actions";
import { ScheduleDialog, type ScheduleNote } from "./schedule-dialog";
import { KindBadge, StatusPill } from "./plan-status";
import { IssueTitle } from "./plan-task-parts";
import { useCollapsed } from "./use-collapsed";

const LABEL_WIDTH = 280;

type Props = StartRunContext & {
  projectId: string;
  repoUrl: string;
  /** The plan's GitHub Project: its link, and whether it has the Start and Target fields. */
  project: PlanProject;
  epics: PlanEpic[];
  unparented: PlanTask[];
  timeline: Timeline;
  /** The zoom from ?zoom=; undefined picks one from the visible range. */
  zoom: Zoom | undefined;
  filters: PlanFilters;
  needsYou: string[];
  /** When the page read GitHub, in epoch milliseconds: the Today line. */
  readAt: number;
};

const KIND_NAME = { epic: "Epic", story: "Story", task: "Task", group: "Unparented" } as const;
const rowLabel = (row: TimelineRow) => (row.item ? `${KIND_NAME[row.kind]} #${row.item.number} ${row.item.title}` : "Unparented");

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

const numbers = (list: number[]) => list.map((n) => `#${n}`).join(", ");

/** What the row says about a task's time: late, blocked, overdue, or outside its parent's window. */
function TimeChips({ task, entry, window }: { task: PlanTask; entry: TimelineItem; window: "story" | "epic" }) {
  const done = taskColumn(task) === "Done";
  const chips = [
    entry.late && (
      <Tag key="late" tone="danger">
        <ClockAlertIcon aria-hidden />
        Late: waiting on {numbers(entry.waitingOn)}
      </Tag>
    ),
    !entry.late && !done && entry.waitingOn.length > 0 && (
      <Tag key="blocked" tone="fill">
        <LockIcon aria-hidden />
        Blocked by {numbers(entry.waitingOn)}
      </Tag>
    ),
    entry.overdueDays !== undefined && (
      <Tag key="overdue" tone="attention">
        <CalendarClockIcon aria-hidden />
        Overdue by {entry.overdueDays === 1 ? "1 day" : `${entry.overdueDays} days`}
      </Tag>
    ),
    entry.outsideParent && (
      <Tag key="outside" className="border-dashed">
        <MoveHorizontalIcon aria-hidden />
        Outside {window} window
      </Tag>
    ),
  ].filter(Boolean);
  if (chips.length === 0) return null;
  return <div className="flex min-w-0 gap-1.5 overflow-hidden">{chips}</div>;
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
  onToggle: () => void;
  onSchedule: (item: PlanItem) => void;
};

/** The fixed left cell of a row: chevron, kind badge or status pill, number and title, the menu, then a task's chips. */
function RowLabel({ row, entry, window, projectId, start, onToggle, onSchedule }: RowLabelProps) {
  const label = rowLabel(row);
  const item = row.item;
  return (
    <div
      role="rowheader"
      className={cn(
        "sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-r border-b bg-card px-2.5",
        row.kind === "story" && "pl-[26px]",
        row.task && (row.level === 3 ? "pl-11" : "pl-[26px]"),
        (row.kind === "epic" || row.kind === "group") && "bg-muted",
      )}
      style={{ width: LABEL_WIDTH }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {row.expanded !== undefined && <Chevron expanded={row.expanded} label={label} onToggle={onToggle} />}
        {row.task ? (
          <StatusPill column={taskColumn(row.task)} spinning={taskColumn(row.task) === "Running" && row.task.run?.status === "running"} />
        ) : (
          row.item && <KindBadge kind={row.kind === "story" ? "story" : "epic"} />
        )}
        {item ? <IssueTitle item={item} className={cn("text-xs", row.kind !== "task" && "font-medium")} /> : <span className="text-[13px] font-medium">Unparented</span>}
        <span className="ml-auto shrink-0">
          {row.task ? (
            <TaskActions task={row.task} projectId={projectId} start={start} compact onSchedule={() => onSchedule(row.task!)} />
          ) : (
            item && <ItemMenu item={item} onSchedule={() => onSchedule(item)} />
          )}
        </span>
      </div>
      {row.task && entry && <TimeChips task={row.task} entry={entry} window={window} />}
    </div>
  );
}

/** Each status's bar: its colour at 70 percent with a border in the full colour. */
const BAR_TONE: Record<PlanColumn, string> = {
  Shaping: "border-muted-foreground/60 bg-muted-foreground/35",
  Ready: "border-active-dot bg-active-dot/70",
  Running: "border-attention-dot bg-attention-dot/70",
  "In review": "border-repaired-dot bg-repaired-dot/70",
  Done: "border-success-dot bg-success-dot/70",
  Other: "border-border bg-muted",
};

/** A bar wider than this repeats the title inside it. */
const TITLE_INSIDE = 120;

const spanText = (span: DaySpan) => (span.start === span.end ? shortDay(span.start) : `${shortDay(span.start)} to ${shortDay(span.end)}`);
/** The left edge and width of a span of whole days. */
const extent = (scale: TimeScale, span: DaySpan) => {
  const left = scale.x(span.start);
  return { left, width: scale.x(addDays(span.end, 1)) - left };
};
const progressOf = (item: unknown): PlanProgress | undefined => (item && typeof item === "object" && "progress" in item ? (item.progress as PlanProgress) : undefined);

/** A row's planned bar: a task's in its status colour, an epic's or a story's in neutral, a derived span as a dashed bracket. */
function PlannedBar({ row, entry, scale, todayX }: { row: TimelineRow; entry: TimelineItem; scale: TimeScale; todayX: number }) {
  const item = row.item!;
  const span = entry.planned ?? entry.derived;
  if (!span) return null;
  const { left, width } = extent(scale, span);
  const name = `${KIND_NAME[row.kind]} #${item.number} ${item.title}`;
  const dates = spanText(span);
  if (row.task) {
    const column = taskColumn(row.task);
    const blocked = entry.waitingOn.length ? `, blocked by ${entry.waitingOn.map((n) => `#${n}`).join(", ")}` : "";
    const overdue = entry.overdueDays !== undefined && todayX > left + width;
    return (
      <>
        {overdue && (
          <span
            aria-hidden
            data-tail
            className="absolute top-1.5 z-[1] h-5 rounded-r-[5px] border-[1.5px] border-l-0 border-dashed border-attention-dot bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--attention-dot)_45%,transparent)_0_2px,transparent_2px_6px)]"
            style={{ left: left + width - 3, width: todayX - (left + width) + 3 }}
          />
        )}
        <a
          href={item.url}
          data-column={column}
          data-late={entry.late}
          aria-label={`${name}, ${column}, ${dates}${blocked}`}
          className={cn(
            "absolute top-1.5 z-[2] flex h-5 items-center overflow-hidden rounded-[5px] border-2 px-1.5 text-[11px] font-medium whitespace-nowrap text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
            BAR_TONE[column],
            entry.planned?.openStart && "[border-left-style:dashed]",
            entry.planned?.openEnd && "[border-right-style:dashed]",
            entry.late && "border-l-[5px] border-l-danger-dot",
          )}
          style={{ left, width }}
        >
          {width > TITLE_INSIDE && <span className="truncate">{item.title}</span>}
        </a>
      </>
    );
  }
  if (!entry.planned) {
    return (
      <a
        href={item.url}
        data-span="derived"
        aria-label={`${name}, ${dates}, derived from its tasks`}
        title="Derived from its tasks"
        className="absolute top-2.5 z-[2] h-[15px] rounded-[4px] border-[1.5px] border-dashed border-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        style={{ left, width }}
      />
    );
  }
  const progress = progressOf(item);
  return (
    <a
      href={item.url}
      data-span="own"
      aria-label={`${name}, ${dates}, own dates${progress ? `, ${progress.done} of ${progress.total} done` : ""}`}
      className={cn(
        "absolute top-2.5 z-[2] h-[15px] overflow-hidden rounded-[4px] border border-muted-foreground/40 bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        entry.planned.openStart && "[border-left-style:dashed]",
        entry.planned.openEnd && "[border-right-style:dashed]",
      )}
      style={{ left, width }}
    >
      {progress && progress.total > 0 && <span aria-hidden className="absolute bottom-0 left-0 h-[3px] bg-success-dot" style={{ width: `${(progress.done / progress.total) * 100}%` }} />}
    </a>
  );
}

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
/** A strip wider than this shows the run's short id beside it. */
const ID_BESIDE = 40;
/** Strips start under the 20 px bar, 6 px tall with a 2 px gap. */
const stripTop = (index: number) => 29 + index * 8;

/** One strip per run that linked the task, newest at the top, each opening its run. */
function Strips({ row, entry, scale, projectId }: { row: TimelineRow; entry: TimelineItem; scale: TimeScale; projectId: string }) {
  const item = row.item!;
  return entry.actual.map((strip, i) => {
    const left = scale.xAt(strip.start);
    const width = Math.max(2, scale.xAt(strip.end) - left);
    const short = strip.runId.slice(0, 8);
    const dates = `${shortDay(dayOfInstant(strip.start))} to ${strip.active ? "now" : shortDay(dayOfInstant(strip.end))}`;
    return (
      <Fragment key={strip.runId}>
        <Link
          href={runPath(projectId, strip.runId)}
          aria-label={`Run ${short} of #${item.number} ${item.title}, ${strip.status}, ${dates}`}
          title={`#${item.number} ${item.title}, ${strip.status}`}
          className={cn("absolute z-[2] h-1.5 rounded-[2px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", STRIP_TONE[statusTone(strip.status)])}
          style={{ left, width, top: stripTop(i) }}
        />
        {width > ID_BESIDE && scale.zoom === "weeks" && (
          <span aria-hidden className="absolute z-[2] font-mono text-[9.5px] leading-[10px] whitespace-nowrap text-muted-foreground" style={{ left: left + width + 4, top: stripTop(i) - 2 }}>
            {short}
          </span>
        )}
      </Fragment>
    );
  });
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

/**
 * The plan as a Gantt chart: a fixed column of row labels in the tree's order and a time pane that
 * scrolls sideways, with planned bars, run strips and dependency arrows.
 */
export function PlanTimeline({ projectId, epics, unparented, timeline, zoom, readAt, graphs, graphName }: Props) {
  const collapsed = useCollapsed(projectId);
  const [scheduling, setScheduling] = useState<PlanItem>();
  const byNumber = useMemo(() => new Map(timeline.items.map((i) => [i.number, i])), [timeline.items]);
  const items = useMemo(
    () => new Map<number, PlanItem>([...epics.flatMap((e) => [e, ...e.stories, ...e.stories.flatMap((s) => s.tasks), ...e.tasks]), ...unparented].map((i) => [i.number, i])),
    [epics, unparented],
  );
  const notesOf = (item: PlanItem): ScheduleNote[] => {
    const notes: ScheduleNote[] = [];
    const seen = new Set<number>();
    for (let p = item.parent; p !== undefined && !seen.has(p); p = items.get(p)?.parent) {
      seen.add(p);
      const parent = items.get(p);
      const entry = byNumber.get(p);
      const span = entry?.planned ?? entry?.derived;
      if (!parent || !span) continue;
      const name = `${parent.kind === "story" ? "Story" : "Epic"} #${parent.number} ${parent.title}`;
      notes.push({ kind: "window", text: entry?.planned ? `${name} runs ${spanText(span)}.` : `${name} spans ${spanText(span)}, derived from its tasks.` });
      break;
    }
    for (const blocker of byNumber.get(item.number)?.waitingOn ?? []) {
      const end = byNumber.get(blocker)?.planned?.end;
      notes.push({ kind: "blocker", text: end ? `Blocked by #${blocker}, planned to end ${shortDay(end)}.` : `Blocked by #${blocker}, not scheduled.` });
    }
    return notes;
  };
  const stories = useMemo(() => new Set(epics.flatMap((e) => e.stories.map((s) => s.number))), [epics]);
  const { rows, height, anchor } = timelineRows(epics, unparented, (key) => !collapsed.has(key), (n) => byNumber.get(n)?.actual.length ?? 0);
  const spans = timeline.items.flatMap((i) => [
    ...[i.planned ?? i.derived].filter((s) => s !== undefined),
    ...i.actual.map((a) => ({ start: dayOfInstant(a.start), end: dayOfInstant(a.end) })),
  ]);
  const range = visibleRange(spans, timeline.today);
  const scale = timeScale(range, zoom ?? defaultZoom(range));
  const todayX = scale.xAt(new Date(readAt).toISOString());

  const barOf = (n: number) => {
    const span = byNumber.get(n)?.planned ?? byNumber.get(n)?.derived;
    if (!span) return undefined;
    const { left, width } = extent(scale, span);
    return { left, right: left + width };
  };
  const stripsOf = (n: number) => {
    const actual = byNumber.get(n)?.actual ?? [];
    if (actual.length === 0) return undefined;
    return { left: Math.min(...actual.map((a) => scale.xAt(a.start))), right: Math.max(...actual.map((a) => scale.xAt(a.end))) };
  };
  const arrows = timeline.arrows.flatMap((arrow) => {
    const from = placeItem(arrow.from, anchor, barOf, stripsOf);
    const to = placeItem(arrow.to, anchor, barOf, stripsOf);
    if (!from || !to || (from.row === to.row && !from.own)) return [];
    return [{ ...arrow, start: from, end: to, d: arrowPath(from, to) }];
  });
  const unscheduled: UnscheduledGroup[] = [
    ...epics.map((e) => ({ title: e.title, items: [e, ...e.stories.flatMap((s) => [s, ...s.tasks]), ...e.tasks] })),
    { title: "Unparented", items: unparented },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => byNumber.get(i.number)?.unscheduled) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="relative overflow-x-auto">
        <div role="grid" aria-label="Timeline" aria-rowcount={rows.length + 1} className="relative text-[13px]" style={{ width: LABEL_WIDTH + scale.width }}>
          <div role="rowgroup">
            <div role="row" aria-label="Time axis" className="flex h-12">
              <div role="columnheader" className="sticky left-0 z-10 flex items-end border-r border-b bg-card px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase" style={{ width: LABEL_WIDTH }}>
                Item
              </div>
              <div role="columnheader" aria-label={`${scale.range.start} to ${scale.range.end}`} className="relative border-b" style={{ width: scale.width }}>
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
              </div>
            </div>
          </div>
          <div role="rowgroup" className="relative" style={{ height }}>
            {rows.map((row) => {
              const entry = row.item && byNumber.get(row.item.number);
              return (
                <div
                  key={row.key}
                  role="row"
                  aria-label={rowLabel(row)}
                  aria-expanded={row.expanded}
                  className={cn("absolute inset-x-0 flex", (row.kind === "epic" || row.kind === "group") && "bg-muted/50")}
                  style={{ top: row.top, height: row.height }}
                >
                  <RowLabel
                    row={row}
                    entry={entry}
                    window={row.item?.parent !== undefined && stories.has(row.item.parent) ? "story" : "epic"}
                    projectId={projectId}
                    start={{ graphs, graphName }}
                    onToggle={() => collapsed.toggle(row.key)}
                    onSchedule={setScheduling}
                  />
                  <div role="gridcell" className="relative border-b" style={{ width: scale.width }}>
                    {entry && <PlannedBar row={row} entry={entry} scale={scale} todayX={todayX} />}
                    {entry && row.task && <Strips row={row} entry={entry} scale={scale} projectId={projectId} />}
                  </div>
                </div>
              );
            })}
            <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: LABEL_WIDTH, width: scale.width }}>
              {scale.weekends.map((c) => (
                <span key={c.x} className="absolute inset-y-0 bg-foreground/[0.04]" style={{ left: c.x, width: c.width }} />
              ))}
              <svg className="absolute inset-0 z-[1] overflow-visible" width={scale.width} height={height}>
                {arrows.map((a) => (
                  <g key={`${a.from}-${a.to}`} data-arrow={`${a.from}-${a.to}`} data-late={a.late} className={a.late ? "text-danger-dot" : "text-muted-foreground"}>
                    <path d={a.d} fill="none" stroke="currentColor" strokeWidth={a.late ? 1.75 : 1.25} />
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
      <Unscheduled groups={unscheduled} undated={timeline.items.every((i) => !i.planned)} onSchedule={setScheduling} />
      <ScheduleDialog projectId={projectId} item={scheduling} notes={scheduling ? notesOf(scheduling) : []} onOpenChange={(open) => !open && setScheduling(undefined)} />
    </div>
  );
}
