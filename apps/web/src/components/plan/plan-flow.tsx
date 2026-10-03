"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CheckIcon, HandIcon, LockIcon } from "lucide-react";
import type { PlanItem } from "@handoff/github";
import type { PlanEpic, PlanTask } from "@/server/plan";
import { Tag } from "@/components/tag";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { layoutFlow, type Flow, type FlowCard, type FlowInput } from "@/lib/plan/flow";
import { matchesQuery } from "@/lib/plan/search";
import { DEFAULT_SIZE, lowerFirst, runsText, schedulerNote, type SchedulerBrief } from "@/lib/plan/flow-text";
import { arrowPath, isHead, itemsOf, progressOf, rowLabel, tasksOf, timelineRows, type Placed, type TimelineRow } from "@/lib/plan/timeline-rows";
import { cn } from "@/lib/utils";
import { TaskActions, type StartRunContext } from "./plan-actions";
import { useSearchQuery } from "./plan-context";
import { PlanFlowList } from "./plan-flow-list";
import { PinSquare, RowTag, SizeBox, SlotSquare } from "./flow-parts";
import { ItemMenu, RowLabel } from "./row-label";
import { useNarrow } from "./timeline-parts";
import { useRowsOpen } from "./use-collapsed";

/** What the Flow takes from the Plan page. */
export type FlowProps = StartRunContext & {
  projectId: string;
  repoUrl: string;
  /** The plan as the filters and the search leave it: the rows. */
  epics: PlanEpic[];
  unparented: PlanTask[];
  /** The whole plan as loadPlan read it for the layout, whatever the filters hide. */
  flow: FlowInput;
  scheduler?: SchedulerBrief | undefined;
  /** During a search, the rows it opens; the collapse store's rows otherwise. */
  searchOpen?: Set<string> | undefined;
};

/** The left column is wider than the Timeline's for the tags under a task's title. */
const LABEL = 330;
/** The order axis before the page measures it, and the narrowest it gets. */
const PANE = 640;
const PANE_MIN = 420;
const PAD_LEFT = 12;
const PAD_RIGHT = 20;
/** The lane strips in the header: the first 24 px down, 14 px apart. */
const LANE_TOP = 24;
const LANE_HEIGHT = 14;
const CARD_HEIGHT = 22;
const MIN_CARD = 14;
/** A running card this wide says "3 of 7 steps"; narrower, "3/7"; narrower still, nothing. */
const LONG_STEPS = 100;
const SHORT_STEPS = 44;

/** Where minutes from now sit on the order axis of a pane `width` wide: every card fits, Now after the work done. */
function axisOf(flow: Flow, width: number) {
  const from = Math.min(0, ...flow.cards.map((c) => c.start));
  const to = Math.max(flow.end, from + 1);
  const unit = (width - PAD_LEFT - PAD_RIGHT) / (to - from);
  const x = (minutes: number) => PAD_LEFT + (minutes - from) * unit;
  return { x, unit, now: x(0), width };
}
type Axis = ReturnType<typeof axisOf>;

/** The top of a slot's strip in the header. */
const laneTop = (slot: number) => LANE_TOP + (slot - 1) * LANE_HEIGHT;

const boxOf = (axis: Axis, card: FlowCard) => ({
  left: axis.x(card.start),
  width: Math.max(MIN_CARD, (card.end - card.start) * axis.unit),
});

/** The width of the order axis: the scroller's width less the left column, followed as the window resizes. */
function usePaneWidth(scroller: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(PANE);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 0) setWidth(Math.max(PANE_MIN, el.clientWidth - LABEL));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scroller]);
  return width;
}

/** What a card says to a screen reader: the task, its place and its slot, a running card's steps and what it waits for. */
function cardName(card: FlowCard, task: PlanItem, breaks: ReadonlyMap<number, number[]>): string {
  const head = `#${task.number} ${task.title}`;
  if (card.kind === "running") {
    const steps = card.progress && card.progress.total > 0 ? `, ${card.progress.done} of ${card.progress.total} steps` : "";
    return `${head}, running${steps}, slot ${card.lane}${card.waitsOn ? `, ${lowerFirst(card.waitsOn)}` : ""}`;
  }
  const place = card.kind === "next" ? `Next ${card.next}` : "Shaping";
  const waits = breaks.get(task.number);
  return `${head}, ${place}, slot ${card.lane}${card.pinned ? ", pinned" : ""}${waits ? `, waits for ${waits.map((n) => `#${n}`).join(", ")}` : ""}`;
}

/** What waits on a person, as the row says it: a run that asks for a review, an answer or a permission. */
const waitsOnYou = (card: FlowCard) => card.waitsOn?.startsWith("Waits on you") ?? false;

/** A running card's steps: "3 of 7 steps" when it fits, "3/7" when short, nothing when too short or unknown. */
function stepsText(card: FlowCard, width: number): string | undefined {
  const progress = card.progress;
  if (!progress || progress.total === 0 || width < SHORT_STEPS) return undefined;
  return width >= LONG_STEPS ? `${progress.done} of ${progress.total} steps` : `${progress.done}/${progress.total}`;
}

/** The hover card of a card: the task's size, its place, its slot, its steps and its blockers. */
function CardDetails({ card, task, items }: { card: FlowCard; task: PlanItem; items: ReadonlyMap<number, PlanItem> }) {
  const place = card.kind === "running" ? "Running" : card.kind === "shaping" ? "Shaping, after every Ready task" : `Next ${card.next}${card.pinned ? ", pinned" : ""}`;
  return (
    <>
      <p className="text-[13px] leading-snug font-semibold">
        #{task.number} {task.title}
      </p>
      <dl className="grid grid-cols-[74px_minmax(0,1fr)] gap-x-2.5 gap-y-1">
        <dt className="text-muted-foreground">Size</dt>
        <dd>{task.size ?? `None, counts as ${DEFAULT_SIZE}`}</dd>
        <dt className="text-muted-foreground">Place</dt>
        <dd>{place}</dd>
        <dt className="text-muted-foreground">Slot</dt>
        <dd>{card.lane}</dd>
        {card.progress && card.progress.total > 0 && (
          <>
            <dt className="text-muted-foreground">Steps</dt>
            <dd>
              {card.progress.done} of {card.progress.total} done
            </dd>
          </>
        )}
        {card.waitsOn && (
          <>
            <dt className="text-muted-foreground">Now</dt>
            <dd>{card.waitsOn}</dd>
          </>
        )}
        {task.blockedBy.length > 0 && (
          <>
            <dt className="text-muted-foreground">Blocked by</dt>
            <dd className="flex flex-col gap-0.5">
              {task.blockedBy.map((n) => (
                <span key={n}>
                  #{n} {items.get(n)?.title}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
    </>
  );
}

const CARD_TONE: Record<FlowCard["kind"], string> = {
  running: "border-attention-dot bg-[color-mix(in_oklab,var(--attention-dot)_18%,var(--card))]",
  next: "border-active-dot bg-[color-mix(in_oklab,var(--active-dot)_22%,var(--card))]",
  shaping: "border-dashed border-muted-foreground/60 bg-muted opacity-60",
};

/**
 * A task's card on its row: running in amber with its done steps filled from the left, Ready in blue, Shaping
 * faded, each with its slot. A run that waits on a person has a dashed ring; a task placed before its blocker a
 * red left edge. It opens the issue on GitHub.
 */
function CardView({
  card,
  task,
  row,
  axis,
  breaks,
  items,
}: {
  card: FlowCard;
  task: PlanItem;
  row: TimelineRow;
  axis: Axis;
  breaks: ReadonlyMap<number, number[]>;
  items: ReadonlyMap<number, PlanItem>;
}) {
  const { left, width } = boxOf(axis, card);
  const waiting = waitsOnYou(card);
  const steps = stepsText(card, width);
  const done = card.progress && card.progress.total > 0 ? card.progress.done / card.progress.total : 0;
  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <a
          href={task.url}
          data-card={card.kind}
          data-waiting={waiting || undefined}
          data-break={breaks.has(task.number) || undefined}
          aria-label={cardName(card, task, breaks)}
          className={cn(
            "absolute z-[2] flex items-center gap-[5px] overflow-hidden rounded-[5px] border-[1.5px] px-1 text-[10.5px] font-medium whitespace-nowrap text-foreground tabular-nums",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
            CARD_TONE[card.kind],
            waiting && "border-dashed ring-[3px] ring-attention-dot/30",
            breaks.has(task.number) && "border-l-[5px] border-l-danger-dot",
          )}
          style={{
            left,
            width,
            top: (row.height - CARD_HEIGHT) / 2,
            height: CARD_HEIGHT,
          }}
        >
          {card.kind === "running" && done > 0 && <span aria-hidden className="absolute inset-y-0 left-0 bg-attention-dot/60" style={{ width: `${done * 100}%` }} />}
          <span className="relative flex min-w-0 items-center gap-[5px] [&_svg]:size-[11px] [&_svg]:shrink-0">
            {width >= 18 && <SlotSquare lane={card.lane} />}
            {waiting && width >= SHORT_STEPS && <HandIcon aria-hidden />}
            {steps && <span className="truncate">{steps}</span>}
            {card.pinned && width >= 38 && <PinSquare title="Pinned by hand" />}
          </span>
        </a>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="flex w-72 flex-col gap-2 text-xs">
        <CardDetails card={card} task={task} items={items} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** The dashed wait in a slot that stood idle until the blocker's card ended, with the lock. */
function WaitBox({ card, flow, axis, row }: { card: FlowCard; flow: Flow; axis: Axis; row: TimelineRow }) {
  const lane = flow.lanes[card.lane - 1] ?? [];
  const before = lane[lane.indexOf(card) - 1];
  const left = axis.x(before?.end ?? 0);
  const width = axis.x(card.start) - left - 3;
  if (width < 6) return null;
  return (
    <span
      title={`Waits for #${card.after}`}
      data-wait
      className="absolute z-[1] grid place-items-center rounded-[5px] border-[1.5px] border-dashed border-muted-foreground/50 text-muted-foreground [&_svg]:size-[11px]"
      style={{
        left,
        width,
        top: (row.height - CARD_HEIGHT) / 2,
        height: CARD_HEIGHT,
      }}
    >
      {width >= 18 && <LockIcon aria-hidden />}
    </span>
  );
}

/** An epic's or a story's span on the axis: from the first card of its tasks to the last, or "2 done" when all are done. */
function SpanCell({ item, cards, axis }: { item: PlanItem; cards: ReadonlyMap<number, FlowCard>; axis: Axis }) {
  const tasks = tasksOf(item);
  const own = tasks.flatMap((t) => (cards.has(t.number) ? [cards.get(t.number)!] : []));
  if (own.length === 0) {
    const progress = progressOf(item);
    if (!progress || progress.total === 0 || progress.done < progress.total) return null;
    return (
      <Tag tone="success" className="absolute top-1/2 left-2 -translate-y-1/2">
        <CheckIcon aria-hidden />
        {progress.done} done
      </Tag>
    );
  }
  const left = axis.x(Math.min(...own.map((c) => c.start)));
  const right = Math.max(...own.map((c) => boxOf(axis, c).left + boxOf(axis, c).width));
  return (
    <span
      title="From its first task to its last"
      className="absolute top-1/2 h-[15px] -translate-y-1/2 rounded-[4px] border-[1.5px] border-dashed border-muted-foreground/60"
      style={{ left, width: right - left }}
    />
  );
}

/** What a task's row shows on the axis: its card, with the wait before it; Done; or Not in the order. */
function TaskCell({
  task,
  row,
  flow,
  axis,
  cards,
  tags,
  breaks,
  items,
}: {
  task: PlanTask;
  row: TimelineRow;
  flow: Flow;
  axis: Axis;
  cards: ReadonlyMap<number, FlowCard>;
  tags: string[];
  breaks: ReadonlyMap<number, number[]>;
  items: ReadonlyMap<number, PlanItem>;
}) {
  const card = cards.get(task.number);
  if (card) {
    return (
      <>
        {card.after !== undefined && <WaitBox card={card} flow={flow} axis={axis} row={row} />}
        <CardView card={card} task={task} row={row} axis={axis} breaks={breaks} items={items} />
      </>
    );
  }
  if (tags.includes("Done")) {
    return (
      <Tag tone="success" className="absolute top-1/2 left-2 -translate-y-1/2">
        <CheckIcon aria-hidden />
        Done
      </Tag>
    );
  }
  if (tags.includes("Not in the order")) {
    return (
      <span
        className="absolute top-1/2 inline-flex h-[18px] -translate-y-1/2 items-center rounded-[5px] border border-dashed px-[7px] text-[10.5px] whitespace-nowrap text-muted-foreground"
        style={{ left: axis.now + 6 }}
      >
        Not in the order
      </span>
    );
  }
  return null;
}

/** The tags a task's row shows under its title; Done and Not in the order show on the axis, Shaping in the status pill. */
const ON_AXIS = new Set(["Done", "Not in the order", "Shaping"]);

/** A Flow row's left cell: the tree's row with the task's size, and its tags under the title. */
function FlowRowLabel({ row, tags, projectId, start, onToggle }: { row: TimelineRow; tags: string[]; projectId: string; start: StartRunContext; onToggle: () => void }) {
  const { item, task } = row;
  const shown = tags.filter((t) => !ON_AXIS.has(t));
  return (
    <RowLabel
      row={row}
      width={LABEL}
      onToggle={onToggle}
      aside={task && <SizeBox task={task} />}
      menu={task ? <TaskActions task={task} projectId={projectId} start={start} compact /> : item && <ItemMenu item={item} />}
      below={
        shown.length > 0 && (
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            {shown.map((t) => (
              <RowTag key={t} text={t} />
            ))}
          </div>
        )
      }
    />
  );
}

/** The header: the lanes named on the left, and on the axis each lane's strip with every card again, Now, and the scheduler's note. */
function LaneHeader({ flow, axis, order, scheduler, lanes }: { flow: Flow; axis: Axis; order: FlowInput["order"]; scheduler: SchedulerBrief | undefined; lanes: number }) {
  const height = LANE_TOP + flow.lanes.length * LANE_HEIGHT;
  const note = schedulerNote(flow, scheduler);
  // Each lane is a slot of the scheduler, numbered from 1.
  const slots = flow.lanes.map((cards, i) => ({ slot: i + 1, cards }));
  return (
    <div role="row" aria-label="Lanes" className="flex" style={{ height }}>
      <div role="columnheader" className="sticky left-0 z-10 shrink-0 border-r border-b bg-card" style={{ width: LABEL }}>
        <span className="absolute top-1.5 left-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Item</span>
        <span className="absolute top-1.5 right-2.5 text-[10.5px] text-muted-foreground">{runsText(lanes, scheduler)}</span>
        {slots.map(({ slot }) => (
          <span key={slot} className="absolute right-2.5 flex items-center text-[10px] tracking-wide text-muted-foreground uppercase tabular-nums" style={{ top: laneTop(slot), height: LANE_HEIGHT }}>
            Slot {slot}
          </span>
        ))}
      </div>
      <div role="columnheader" aria-label="Order" className="relative flex-1 overflow-hidden border-b" style={{ minWidth: axis.width }}>
        <Past width={axis.now} />
        {slots.map(({ slot, cards }) => (
          <ul key={slot} aria-label={`Slot ${slot}`} className="absolute inset-x-0 border-t" style={{ top: laneTop(slot), height: LANE_HEIGHT }}>
            {cards.map((c) => {
              const { left, width } = boxOf(axis, c);
              return (
                <li
                  key={c.issue}
                  title={`#${c.issue}, slot ${slot}`}
                  className={cn(
                    "absolute top-0.5 h-2.5 overflow-hidden rounded-[3px] px-1 font-mono text-[8.5px] leading-[10px] whitespace-nowrap text-foreground",
                    c.kind === "running" ? "bg-attention-dot/55" : c.kind === "next" ? "bg-active-dot/35" : "bg-muted-foreground/25",
                  )}
                  style={{ left, width }}
                >
                  #{c.issue}
                </li>
              );
            })}
          </ul>
        ))}
        <span aria-hidden className="absolute top-5 bottom-0 z-[3] w-0.5 -translate-x-1/2 bg-foreground/85" style={{ left: axis.now }} />
        <span className="absolute top-1 z-[4] -translate-x-1/2 rounded-[4px] bg-foreground px-1.5 py-px text-[9.5px] font-semibold text-background" style={{ left: axis.now }}>
          Now
        </span>
        {note && (
          <Tag
            tone={note.tone}
            title={note.text}
            className="absolute top-[3px] z-[4] h-[18px] max-w-[min(420px,calc(100%-40px))] overflow-hidden rounded-full bg-card px-[7px] text-[10.5px]"
            style={{ left: axis.now + 26 }}
          >
            <span className="truncate">{note.text}</span>
          </Tag>
        )}
        <span className="absolute top-[5px] right-2.5 text-[10.5px] text-muted-foreground">{order === "priority" ? "Priority order" : "Project order"}. Length by size.</span>
      </div>
    </div>
  );
}

/** The hatch over what is already done, left of Now. */
function Past({ width }: { width: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0 bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--foreground)_4%,transparent)_0_5px,transparent_5px_10px)]"
      style={{ width }}
    />
  );
}

type FlowArrow = {
  from: number;
  to: number;
  red: boolean;
  d: string;
  end: Placed;
};

/** The arrows from a blocker's card end to the start of the card it blocks, red when the task is placed before it. */
function flowArrows(flow: Flow, rows: TimelineRow[], cards: ReadonlyMap<number, FlowCard>, axis: Axis, breaks: ReadonlyMap<number, number[]>): FlowArrow[] {
  const rowOf = new Map(rows.flatMap((r) => (r.task ? [[r.task.number, r] as const] : [])));
  const place = (issue: number): Placed | undefined => {
    const row = rowOf.get(issue);
    const card = cards.get(issue);
    if (!row || !card) return undefined;
    const { left, width } = boxOf(axis, card);
    return {
      row,
      own: true,
      left,
      right: left + width,
      y: row.top + row.height / 2,
    };
  };
  // A task placed before its blocker: the arrow between them is red.
  const early = new Set([...breaks].flatMap(([issue, waitsFor]) => waitsFor.map((blocker) => `${blocker}-${issue}`)));
  return flow.arrows.flatMap(({ from, to }) => {
    const start = place(from);
    const end = place(to);
    if (!start || !end) return [];
    return [
      {
        from,
        to,
        red: early.has(`${from}-${to}`),
        d: arrowPath(start, end),
        end,
      },
    ];
  });
}

function ArrowLayer({ arrows, width, height }: { arrows: FlowArrow[]; width: number; height: number }) {
  return (
    <svg aria-hidden className="absolute inset-0 z-[1] overflow-visible" width={width} height={height}>
      {arrows.map((a) => (
        <g key={`${a.from}-${a.to}`} data-arrow={`${a.from}-${a.to}`} className={a.red ? "text-danger-dot" : "text-muted-foreground"}>
          <path d={a.d} fill="none" stroke="currentColor" strokeWidth={a.red ? 1.75 : 1.25} />
          <path d={`M${a.end.left} ${a.end.y} l-5 -3.5 v7 z`} fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

/**
 * The plan in order without dates (docs/plans/flow.md, Decisions 4 to 6 and 13): the tree's rows on the left,
 * and on the order axis each task's card on its row in the slot the scheduler would start it in, the slot
 * strips repeating every card, the Now line, the scheduler's hold, and arrows from each blocker to what it
 * blocks. Lengths follow the sizes and only decide which slot frees first.
 */
function FlowChart({ projectId, epics, unparented, flow: input, scheduler, graphs, graphName, searchOpen }: FlowProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const width = usePaneWidth(scroller);
  const rowsOpen = useRowsOpen(projectId, searchOpen);
  const q = useSearchQuery();
  const flow = useMemo(() => layoutFlow(input), [input]);
  const axis = axisOf(flow, width);
  const cards = new Map(flow.cards.map((c) => [c.issue, c]));
  const tags = new Map(flow.rows.map((r) => [r.issue, r.tags]));
  const breaks = new Map(flow.breaks.map((b) => [b.issue, b.waitsFor]));
  const items = new Map<number, PlanItem>([...input.tasks.map((t) => [t.number, t] as const), ...itemsOf(epics, unparented)]);
  const { rows, height } = timelineRows(epics, unparented, rowsOpen.isOpen, () => 0);
  const arrows = flowArrows(flow, rows, cards, axis, breaks);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div ref={scroller} className="overflow-x-auto overscroll-x-contain">
        <div role="grid" aria-label="Flow" aria-rowcount={rows.length + 1} className="relative text-[13px]" style={{ width: LABEL + axis.width, minWidth: "100%" }}>
          <div role="rowgroup">
            <LaneHeader flow={flow} axis={axis} order={input.order} scheduler={scheduler} lanes={input.lanes} />
          </div>
          <div role="rowgroup" className="relative" style={{ height }}>
            {/* Under the rows, so the hatch and the arrows pass behind the cards; the Now line stays on top. */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: LABEL, width: axis.width }}>
              <Past width={axis.now} />
              <ArrowLayer arrows={arrows} width={axis.width} height={height} />
              <span className="absolute inset-y-0 z-[3] w-0.5 -translate-x-1/2 bg-foreground/85" style={{ left: axis.now }} />
            </div>
            {rows.map((row) => (
              <div
                key={row.key}
                role="row"
                aria-label={rowLabel(row)}
                aria-expanded={row.expanded}
                data-match={(row.item && matchesQuery(row.item, q)) || undefined}
                className={cn("absolute inset-x-0 flex", isHead(row) && "bg-muted/50")}
                style={{ top: row.top, height: row.height }}
              >
                <FlowRowLabel row={row} tags={(row.task && tags.get(row.task.number)) ?? []} projectId={projectId} start={{ graphs, graphName }} onToggle={() => rowsOpen.toggle(row.key)} />
                <div role="gridcell" className="relative flex-1 border-b" style={{ minWidth: axis.width }}>
                  {row.task ? (
                    <TaskCell task={row.task} row={row} flow={flow} axis={axis} cards={cards} tags={tags.get(row.task.number) ?? []} breaks={breaks} items={items} />
                  ) : (
                    row.item && <SpanCell item={row.item} cards={cards} axis={axis} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Flow view: the chart, or under 640 px a list in order with each task's slot and Next tags. */
export function PlanFlow(props: FlowProps) {
  return useNarrow() ? <PlanFlowList {...props} /> : <FlowChart {...props} />;
}
