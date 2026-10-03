"use client";

import { startTransition, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, HandIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import type { PlanItem } from "@handoff/github";
import type { PlanEpic, PlanTask } from "@/server/plan";
import { unpinAction, writeOrderAction } from "@/app/projects/actions";
import { switchToProjectOrderAction } from "@/app/projects/scheduler-actions";
import { Tag } from "@/components/tag";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { layoutFlow, reorderFlow, type Flow, type FlowCard, type FlowInput } from "@/lib/plan/flow";
import { moveTo, ruleBreaks } from "@/lib/plan/flow-order";
import { matchesQuery } from "@/lib/plan/search";
import { chainPlace, thenPath } from "@/lib/plan/story-order";
import { optimize } from "@/lib/plan/optimize";
import { isMixed, isTicked, scopeName, scopeOf, selectionTree, togglePick, type SelectionTree } from "@/lib/plan/selection";
import { appliedSentence, DEFAULT_SIZE, lowerFirst, runsText, schedulerNote, tasksText, type SchedulerBrief } from "@/lib/plan/flow-text";
import { arrowPath, isHead, itemsOf, progressOf, rowLabel, tasksOf, timelineRows, type Placed, type TimelineRow } from "@/lib/plan/timeline-rows";
import { cn } from "@/lib/utils";
import { TaskActions, type StartRunContext } from "./plan-actions";
import { OptimizePreview } from "./optimize-preview";
import { useFlowSelection, useSearchQuery, type FlowSelectionControl } from "./plan-context";
import { PlanFlowList } from "./plan-flow-list";
import { PinButton, PinnedTag, PinSquare, RowTag, SizeBox, SlotSquare } from "./flow-parts";
import { PriorityOrderDialog } from "./priority-order-dialog";
import { RuleBreakDialog, type BreakChoice, type RuleBreakDrop } from "./rule-break-dialog";
import { ItemMenu, RowLabel } from "./row-label";
import { useNarrow } from "./timeline-parts";
import { placeMove, useCardDrag, type CardMove, type CardPlace } from "./use-card-drag";
import { useRowsOpen } from "./use-collapsed";
import { useStoryOrder } from "./use-story-order";

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
function axisOf(flow: Pick<Flow, "cards" | "end">, width: number) {
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

/**
 * What a card says to a screen reader: the task, its place and its slot, a running card's steps and what it
 * waits for, and in Optimize's preview the place it moves from.
 */
function cardName(card: FlowCard, task: PlanItem, breaks: ReadonlyMap<number, number[]>, was?: number): string {
  const head = `#${task.number} ${task.title}`;
  if (card.kind === "running") {
    const steps = card.progress && card.progress.total > 0 ? `, ${card.progress.done} of ${card.progress.total} steps` : "";
    return `${head}, running${steps}, slot ${card.lane}${card.waitsOn ? `, ${lowerFirst(card.waitsOn)}` : ""}`;
  }
  const place = card.kind === "next" ? `Next ${card.next}` : "Shaping";
  const waits = breaks.get(task.number);
  const moved = was !== undefined ? `, moved by Optimize from Next ${was}` : "";
  return `${head}, ${place}, slot ${card.lane}${card.pinned ? ", pinned" : ""}${waits ? `, waits for ${waits.map((n) => `#${n}`).join(", ")}` : ""}${moved}`;
}

/** What waits on a person, as the row says it: a run that asks for a review, an answer or a permission. */
const waitsOnYou = (card: FlowCard) => card.waitsOn?.startsWith("Waits on you") ?? false;

/** A running card's steps: "3 of 7 steps" when it fits, "3/7" when short, nothing when too short or unknown. */
function stepsText(card: FlowCard, width: number): string | undefined {
  const progress = card.progress;
  if (!progress || progress.total === 0 || width < SHORT_STEPS) return undefined;
  return width >= LONG_STEPS ? `${progress.done} of ${progress.total} steps` : `${progress.done}/${progress.total}`;
}

/** An issue as "#74 Voice errors in the transcript strip". */
const issueText = (n: number, items: ReadonlyMap<number, PlanItem>) => {
  const title = items.get(n)?.title;
  return title ? `#${n} ${title}` : `#${n}`;
};

/** Where a card sits in its story's chain, for its hover card: "2 of 3" in the story, and the task after it. */
type StoryPlace = { place: number; total: number; parent: number; next: number | undefined };

/** The hover card of a card: the task's size, its place, its slot, its steps, its blockers, and its story's order. */
function CardDetails({ card, task, items, story }: { card: FlowCard; task: PlanItem; items: ReadonlyMap<number, PlanItem>; story: StoryPlace | undefined }) {
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
        {story && (
          <>
            <dt className="text-muted-foreground">Story</dt>
            <dd>{`${story.place} of ${story.total} in ${issueText(story.parent, items)}`}</dd>
          </>
        )}
        {story?.next !== undefined && (
          <>
            <dt className="text-muted-foreground">Then</dt>
            <dd>{issueText(story.next, items)}</dd>
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

const CARD =
  "absolute z-[2] flex items-center gap-[5px] overflow-hidden rounded-[5px] border-[1.5px] px-1 text-[10.5px] font-medium whitespace-nowrap text-foreground tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none";

/** What a card shows inside: a running card's done steps filled from the left, its slot, the hand while it waits on a person, its steps, and the pin on a card that does not drag. */
function CardFace({ card, width, waiting }: { card: FlowCard; width: number; waiting: boolean }) {
  const steps = stepsText(card, width);
  const done = card.progress && card.progress.total > 0 ? card.progress.done / card.progress.total : 0;
  return (
    <>
      {card.kind === "running" && done > 0 && <span aria-hidden className="absolute inset-y-0 left-0 bg-attention-dot/60" style={{ width: `${done * 100}%` }} />}
      <span className="relative flex min-w-0 items-center gap-[5px] [&_svg]:size-[11px] [&_svg]:shrink-0">
        {width >= 18 && <SlotSquare lane={card.lane} />}
        {waiting && width >= SHORT_STEPS && <HandIcon aria-hidden />}
        {steps && <span className="truncate">{steps}</span>}
        {card.pinned && card.kind !== "next" && width >= PIN_WIDTH && <PinSquare title="Pinned by hand" />}
      </span>
    </>
  );
}

/**
 * The story chain of the hovered or focused card (issue #543): its cards light up and every other card fades.
 * `lit` is undefined while no chain is lit.
 */
type CardHover = {
  lit: ReadonlySet<number> | undefined;
  hovered: number | undefined;
  onHover: (issue: number | undefined) => void;
  storyOf: (issue: number) => StoryPlace | undefined;
};

/**
 * How a card shows the lit chain: full strength in it, faded out of it, a ring on the hovered card, and the
 * handlers that light its own chain on hover and focus. Its blur goes with the drag's.
 */
function chainProps(hover: CardHover, issue: number) {
  const lit = hover.lit?.has(issue) ?? false;
  const dimmed = hover.lit !== undefined && !lit;
  return {
    "data-chain": lit || undefined,
    "data-dimmed": dimmed || undefined,
    onPointerEnter: () => hover.onHover(issue),
    onPointerLeave: () => hover.onHover(undefined),
    onFocus: () => hover.onHover(issue),
    className: cn(lit && "opacity-100", lit && hover.hovered === issue && "ring-[1.5px] ring-foreground", dimmed && "opacity-30"),
  };
}

/** What a card that drags spreads on its link, from useCardDrag. */
type DragProps = ReturnType<ReturnType<typeof useCardDrag>["cardProps"]>;

/** A card is wide enough for its pin when it is this wide. */
const PIN_WIDTH = 38;

/**
 * A task's card on its row: running in amber with its done steps filled from the left, Ready in blue, Shaping
 * faded, each with its slot. A run that waits on a person has a dashed ring; a task placed before its blocker a
 * red left edge. It opens the issue on GitHub. A Ready card drags; while it moves it is lifted and the hover card
 * stays closed. A pinned card's pin is a button beside the link that unpins it. Hovering or focusing a card
 * lights up its story's chain.
 */
function CardView({
  card,
  task,
  row,
  axis,
  breaks,
  items,
  drag,
  lifted,
  quiet,
  was,
  onUnpin,
  hover,
}: {
  card: FlowCard;
  task: PlanItem;
  row: TimelineRow;
  axis: Axis;
  breaks: ReadonlyMap<number, number[]>;
  items: ReadonlyMap<number, PlanItem>;
  drag: DragProps | undefined;
  lifted: boolean;
  quiet: boolean;
  /** In Optimize's preview, the Next place the card moves from. */
  was: number | undefined;
  onUnpin: (issue: number) => void;
  /** How the hovered card's story lights this card. */
  hover: CardHover;
}) {
  const [open, setOpen] = useState(false);
  const { left, width } = boxOf(axis, card);
  const waiting = waitsOnYou(card);
  const { className: chainLook, ...chain } = chainProps(hover, card.issue);
  const top = (row.height - CARD_HEIGHT) / 2;
  // A Ready card's pin unpins it; a running card's pin is gone once the scheduler starts its run.
  const pinButton = card.pinned && card.kind === "next" && width >= PIN_WIDTH;
  return (
    <>
      <HoverCard openDelay={300} closeDelay={100} open={open && !quiet} onOpenChange={setOpen}>
        <HoverCardTrigger asChild>
          <a
            href={task.url}
            data-card={card.kind}
            data-waiting={waiting || undefined}
            data-break={breaks.has(task.number) || undefined}
            data-preview={was !== undefined || undefined}
            aria-label={cardName(card, task, breaks, was)}
            {...chain}
            {...drag}
            onBlur={() => {
              drag?.onBlur();
              hover.onHover(undefined);
            }}
            className={cn(
              CARD,
              CARD_TONE[card.kind],
              waiting && "border-dashed ring-[3px] ring-attention-dot/30",
              breaks.has(task.number) && "border-l-[5px] border-l-danger-dot",
              was !== undefined && "border-dashed ring-2 ring-active-dot/25",
              drag && "cursor-grab touch-none select-none hover:ring-1 hover:ring-foreground/60",
              chainLook,
              lifted && "z-[7] cursor-grabbing shadow-lg ring-1 ring-foreground/60",
            )}
            style={{ left, width, top, height: CARD_HEIGHT }}
          >
            <CardFace card={card} width={width} waiting={waiting} />
          </a>
        </HoverCardTrigger>
        <HoverCardContent align="start" className="flex w-[330px] flex-col gap-2 text-xs">
          <CardDetails card={card} task={task} items={items} story={hover.storyOf(card.issue)} />
        </HoverCardContent>
      </HoverCard>
      {pinButton && <PinButton issue={task.number} onUnpin={onUnpin} className={cn("absolute", lifted ? "z-[8]" : "z-[3]")} style={{ left: left + width - 19, top: top + 4 }} />}
    </>
  );
}

/** What a moving card says: where it lands, which slot it takes and how many cards change slots, and a warning before a blocker. */
function DragTip({ tip, left }: { tip: CardPlace["tip"]; left: number }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-[calc(50%+14px)] z-[12] flex flex-col gap-0.5 rounded-md border bg-popover px-2.5 py-1.5 text-[11.5px] leading-snug whitespace-nowrap text-muted-foreground shadow-md"
      style={{ left: Math.max(0, left) }}
    >
      <b className="font-semibold text-foreground">{tip.title}</b>
      {tip.line && <span>{tip.line}</span>}
      {tip.warning && (
        <span className="mt-0.5 flex items-center gap-1.5 font-medium text-danger">
          <TriangleAlertIcon aria-hidden className="size-3" />
          {tip.warning}
        </span>
      )}
    </div>
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

/** How the cards drag: the props of a card that drags, the card that moves with its old box and tooltip, and the pin's unpin. */
type CardDrag = {
  propsOf: (card: FlowCard) => DragProps | undefined;
  moving?: { issue: number; ghost: { left: number; width: number }; tip?: CardPlace["tip"] | undefined } | undefined;
  /** While a card moves or a dialog asks about a drop, hover cards stay closed. */
  quiet: boolean;
  onUnpin: (issue: number) => void;
  /** Optimize's preview: each moved task's old Next place, and its old box on the axis. */
  preview?: { was: ReadonlyMap<number, number>; ghosts: ReadonlyMap<number, { left: number; width: number }> } | undefined;
};

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
  drag,
  hover,
}: {
  task: PlanTask;
  row: TimelineRow;
  flow: Flow;
  axis: Axis;
  cards: ReadonlyMap<number, FlowCard>;
  tags: string[];
  breaks: ReadonlyMap<number, number[]>;
  items: ReadonlyMap<number, PlanItem>;
  drag: CardDrag;
  hover: CardHover;
}) {
  const card = cards.get(task.number);
  const moving = drag.moving?.issue === task.number ? drag.moving : undefined;
  const ghost = moving?.ghost ?? drag.preview?.ghosts.get(task.number);
  if (card) {
    return (
      <>
        {card.after !== undefined && <WaitBox card={card} flow={flow} axis={axis} row={row} />}
        {ghost && (
          <span
            aria-hidden
            data-ghost
            title={moving ? undefined : "Where it is now"}
            className="absolute z-[1] rounded-[5px] border-[1.5px] border-dashed border-muted-foreground bg-foreground/5"
            style={{ ...ghost, top: (row.height - CARD_HEIGHT) / 2, height: CARD_HEIGHT }}
          />
        )}
        <CardView
          card={card}
          task={task}
          row={row}
          axis={axis}
          breaks={breaks}
          items={items}
          drag={drag.propsOf(card)}
          lifted={moving !== undefined}
          quiet={drag.quiet}
          was={card.kind === "next" ? drag.preview?.was.get(task.number) : undefined}
          onUnpin={drag.onUnpin}
          hover={hover}
        />
        {moving?.tip && <DragTip tip={moving.tip} left={boxOf(axis, card).left} />}
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

/** A row's tick box: ticked, half ticked when something under it is, or not. */
type Tick = { checked: boolean | "indeterminate"; onClick: () => void };

/** A Flow row's left cell: the tick box, the tree's row with the task's size, and its tags under the title. */
function FlowRowLabel({
  row,
  tags,
  tick,
  was,
  projectId,
  start,
  onToggle,
  onUnpin,
}: {
  row: TimelineRow;
  tags: string[];
  tick: Tick | undefined;
  /** In Optimize's preview, the Next place the task moves from. */
  was: number | undefined;
  projectId: string;
  start: StartRunContext;
  onToggle: () => void;
  onUnpin: (issue: number) => void;
}) {
  const { item, task } = row;
  const shown = tags.filter((t) => !ON_AXIS.has(t));
  return (
    <RowLabel
      row={row}
      width={LABEL}
      lead={tick && item && <Checkbox aria-label={`Select #${item.number}`} checked={tick.checked} onCheckedChange={tick.onClick} className="bg-card" />}
      onToggle={onToggle}
      aside={task && <SizeBox task={task} />}
      menu={task ? <TaskActions task={task} projectId={projectId} start={start} compact /> : item && <ItemMenu item={item} />}
      below={
        shown.length > 0 && (
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            {shown.map((t) => (t === "Pinned" && task ? <PinnedTag key={t} issue={task.number} onUnpin={onUnpin} /> : <RowTag key={t} text={t} was={t.startsWith("Next ") ? was : undefined} />))}
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
  /** It joins two cards of the lit chain. */
  lit: boolean;
};

type ThenArrow = { from: number; to: number; d: string; head: string; lit: boolean };

/** Where each card sits over the rows: its box on the axis and its row's middle; a card whose row is hidden has none. */
function placer(rows: TimelineRow[], cards: ReadonlyMap<number, FlowCard>, axis: Axis) {
  const rowOf = new Map(rows.flatMap((r) => (r.task ? [[r.task.number, r] as const] : [])));
  return (issue: number): Placed | undefined => {
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
}

/** The pairs of cards that follow each other in a chain, as "from-to". */
const pairsOf = (issues: readonly number[]) => new Set(issues.slice(1).map((to, index) => `${issues[index]}-${to}`));

/**
 * The arrows from a blocker's card end to the start of the card it blocks, red when the task is placed before it.
 * A blocker arrow between two cards that follow each other in the lit chain stands in for their then arrow and lights up with it.
 */
function flowArrows(
  flow: Flow,
  place: (issue: number) => Placed | undefined,
  breaks: ReadonlyMap<number, number[]>,
  lit: ReadonlySet<string>,
): FlowArrow[] {
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
        lit: lit.has(`${from}-${to}`),
      },
    ];
  });
}

/** The then arrows from each card to the next card of its story; a collapsed story's cards have no rows and so no arrows. */
function thenArrows(flow: Flow, place: (issue: number) => Placed | undefined, lit: ReadonlySet<string>): ThenArrow[] {
  return flow.then.flatMap(({ from, to }) => {
    const start = place(from);
    const end = place(to);
    if (!start || !end) return [];
    return [{ from, to, ...thenPath(start, end, CARD_HEIGHT / 2), lit: lit.has(`${from}-${to}`) }];
  });
}

/** The blocker arrows, and the then arrows unless the Legend's switch hides them in this browser. */
function useArrows(flow: Flow, place: (issue: number) => Placed | undefined, breaks: ReadonlyMap<number, number[]>, lit: ReadonlySet<string>) {
  const [showThen] = useStoryOrder();
  return { arrows: flowArrows(flow, place, breaks, lit), then: showThen ? thenArrows(flow, place, lit) : [] };
}

/**
 * The blocker arrows, solid with a filled head, and the then arrows, lighter: 1 px, dashed, with a small open head.
 * While a chain is lit, its arrows go to full strength and the rest fade.
 */
function ArrowLayer({ arrows, then, lighting, width, height }: { arrows: FlowArrow[]; then: ThenArrow[]; lighting: boolean; width: number; height: number }) {
  return (
    <svg aria-hidden className="absolute inset-0 z-[1] overflow-visible" width={width} height={height}>
      {arrows.map((a) => (
        <g
          key={`${a.from}-${a.to}`}
          data-arrow={`${a.from}-${a.to}`}
          data-lit={a.lit || undefined}
          className={cn(a.red ? "text-danger-dot" : "text-muted-foreground", lighting && (a.lit ? !a.red && "text-foreground" : "opacity-25"))}
        >
          <path d={a.d} fill="none" stroke="currentColor" strokeWidth={a.red ? 1.75 : 1.25} />
          <path d={`M${a.end.left} ${a.end.y} l-5 -3.5 v7 z`} fill="currentColor" />
        </g>
      ))}
      {then.map((a) => (
        <g
          key={`${a.from}-${a.to}`}
          data-then={`${a.from}-${a.to}`}
          data-lit={a.lit || undefined}
          className={cn("text-muted-foreground", lighting && (a.lit ? "text-foreground" : "opacity-25"))}
        >
          <path d={a.d} fill="none" stroke="currentColor" strokeWidth={a.lit ? 1.5 : 1} strokeDasharray="3 2.5" />
          <path d={a.head} fill="none" stroke="currentColor" strokeWidth={a.lit ? 1.6 : 1.25} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
    </svg>
  );
}

const issuesText = (list: readonly number[]) => {
  const named = list.map((n) => `#${n}`);
  return named.length <= 1 ? (named[0] ?? "") : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
};
const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/** A new order of the queue to write: the queue GitHub holds and the new one, the pins before and after, and the pin changes. */
type OrderWrite = {
  shown: number[];
  queue: number[];
  before: ReadonlySet<number>;
  pins: ReadonlySet<number>;
  pin?: number[] | undefined;
  unpin?: number[] | undefined;
  reason?: "keep_here" | undefined;
};

/** A drop's write: the task that moved, and Keep it here's blockers. */
type OrderChange = OrderWrite & {
  issue: number;
  /** Keep it here: the task stays where it was dropped, before the blockers it waits for. */
  keep?: { waitsFor: number[] } | undefined;
};

/** What a write's toasts say: while it saves, after it is refused, and once GitHub took it, with its Undo. */
type WriteText = {
  saving: string;
  back: string;
  title: string;
  description: string;
  undo?: (() => void) | undefined;
};

/** A drop of `issue` that gives `queue`: the card is pinned at its new place. */
const dropChange = (issue: number, shown: number[], queue: number[], pins: ReadonlySet<number>, keep?: OrderChange["keep"]): OrderChange => ({
  issue,
  shown,
  queue,
  before: pins,
  pins: new Set([...pins, issue]),
  pin: [issue],
  keep,
});

/** The write that undoes a drop: the old order back, and the drop's pin removed unless the task was pinned before. */
const undoOf = (c: OrderChange): OrderChange => ({
  issue: c.issue,
  shown: c.queue,
  queue: c.shown,
  before: c.pins,
  pins: c.before,
  unpin: c.before.has(c.issue) ? undefined : [c.issue],
});

/** What the page shows over loadPlan's input until the next read: the order and pins it saved, and Project order after a switch. */
type Local = { input: FlowInput; queue?: number[] | undefined; pins?: ReadonlySet<number> | undefined; order?: "project" | undefined };

/**
 * The Flow's writes (docs/plans/flow.md, Decision 9), the timeline's useMoves pattern: a drop, a dialog's choice,
 * Optimize's Apply and their Undo write the queue's new order at once, with a saving toast, then one that names the move with
 * Undo, or one that says GitHub refused it with Try again. The cards show the new order until the next read
 * from GitHub, and go back when the write is refused. The pin on a card unpins it the same way.
 */
function useOrderWrites(projectId: string, input: FlowInput) {
  const router = useRouter();
  const [local, setLocal] = useState<Local>({ input });
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  const shown = useMemo(() => {
    if (local.input !== input) return input;
    const ordered = local.order ? { ...input, order: local.order } : input;
    const moved = local.queue ? reorderFlow(ordered, local.queue) : ordered;
    return local.pins ? { ...moved, pins: local.pins } : moved;
  }, [input, local]);

  const put = (patch: Omit<Local, "input">) => setLocal((s) => ({ ...(s.input === latest.current ? s : { input: latest.current }), ...patch }));

  /** Writes the order with the toasts `text` names; the cards show it at once and go back when GitHub refuses it. */
  const commit = (c: OrderWrite, text: WriteText) => {
    const id = toast.loading("Saving the order to GitHub", { description: text.saving });
    put({ queue: c.queue, pins: c.pins });
    startTransition(async () => {
      const result = await writeOrderAction({
        projectId,
        shown: c.shown,
        queue: c.queue,
        ...(c.pin ? { pin: c.pin } : {}),
        ...(c.unpin ? { unpin: c.unpin } : {}),
        ...(c.reason ? { reason: c.reason } : {}),
      });
      if (!result.ok) {
        put({ queue: c.shown, pins: c.before });
        toast.error("GitHub did not take the order", {
          id,
          description: `${text.back}${result.error ? ` ${result.error}` : ""}`,
          action: { label: "Try again", onClick: () => commit(c, text) },
        });
        return;
      }
      startTransition(() => router.refresh());
      toast.success(text.title, { id, description: text.description, ...(text.undo ? { action: { label: "Undo", onClick: text.undo } } : {}) });
    });
  };

  /** A drop or a dialog's choice, and its Undo. */
  const save = (c: OrderChange, undo = false) => {
    const n = c.issue;
    const from = c.shown.indexOf(n) + 1;
    const to = c.queue.indexOf(n) + 1;
    const moved = `#${n} ${c.keep || from === to ? "stays at" : "moves to"} Next ${to}`;
    commit(
      { ...c, reason: c.keep ? "keep_here" : undefined },
      undo
        ? { saving: `#${n} goes back to Next ${to}`, back: `#${n} is back at Next ${from}.`, title: `Put #${n} back at Next ${to}`, description: "Saved to GitHub in Project order." }
        : {
            saving: moved,
            back: `#${n} is back at Next ${from}.`,
            title: moved,
            description: c.keep ? `Pinned. It waits for ${issuesText(c.keep.waitsFor)}.` : `Saved to GitHub in Project order. #${n} is pinned.`,
            undo: () => save(undoOf(c), true),
          },
    );
  };

  /** Optimize's Apply: the new order with no pin changes, and its Undo, which writes the old order back. */
  const applyOptimized = (shownQueue: number[], queue: number[], text: { scope: string; moved: number; kept: number }) => {
    const pins = shown.pins;
    const back = "The order is back as it was.";
    const undo = () =>
      commit({ shown: queue, queue: shownQueue, before: pins, pins }, { saving: "The order goes back", back: "The optimized order stays.", title: "Put the order back", description: "Saved to GitHub in Project order." });
    commit(
      { shown: shownQueue, queue, before: pins, pins },
      { saving: `Moving ${tasksText(text.moved)}`, back, title: `Optimized ${text.scope}`, description: appliedSentence(text.moved, text.kept), undo },
    );
  };

  const unpin = (n: number) => {
    const before = shown.pins;
    put({ pins: new Set([...before].filter((p) => p !== n)) });
    startTransition(async () => {
      const result = await unpinAction({ projectId, issue: n });
      if (!result.ok) {
        put({ pins: before });
        toast.error(`#${n} is still pinned`, { description: result.error });
        return;
      }
      toast.success(`#${n} is unpinned`, { description: "It no longer keeps its place." });
      startTransition(() => router.refresh());
    });
  };

  /** "Switch to Project order": saves the scheduler's order, then runs `then`, the drop that asked for it. */
  const switchToProject = (then: () => void) =>
    startTransition(async () => {
      const result = await switchToProjectOrderAction({ projectId });
      if (!result.ok) {
        toast.error("The scheduler still starts tasks by Priority", { description: result.error });
        return;
      }
      put({ order: "project" });
      then();
    });

  return { shown, save, applyOptimized, unpin, switchToProject };
}

/** A drop that asks first: to switch to Project order, or where a task placed before its blocker goes. */
type PendingDrop = {
  kind: "priority" | "rule";
  place: CardPlace;
  /** The queue the drop was made in, and the queue GitHub holds, which differ under Priority order. */
  base: number[];
  shown: number[];
  waitsFor: number[];
};

/**
 * The drops on the Flow: a Ready card moves to a new place in the queue, pinned. Under Priority order a drop asks
 * to switch to Project order first; a drop before an open blocker asks where the task goes. The card shows where
 * it lands while it moves and while a dialog asks.
 */
function useFlowDrops(projectId: string, input: FlowInput, width: number) {
  const writes = useOrderWrites(projectId, input);
  const { shown } = writes;
  const flow = useMemo(() => layoutFlow(shown), [shown]);
  // A drag's pixels in minutes on the axis before the move, so the scale does not follow the preview.
  const unit = axisOf(flow, width).unit;
  const blockers = useMemo(() => new Map(shown.tasks.map((t) => [t.number, t.blockedBy] as const)), [shown]);
  const [pending, setPending] = useState<PendingDrop>();

  /** Saves a drop in Project order, or asks where it goes when it puts the task before an open blocker. */
  const land = (place: CardPlace, base: number[], shownQueue: number[]) => {
    const waits = ruleBreaks(moveTo(base, place.issue, place.index), blockers).find((b) => b.issue === place.issue);
    if (waits) {
      setPending({ kind: "rule", place, base, shown: shownQueue, waitsFor: waits.waitsFor });
      return;
    }
    setPending(undefined);
    writes.save(dropChange(place.issue, shownQueue, place.queue, shown.pins));
  };

  const onDrop = (move: CardMove) => {
    const place = placeMove(shown, flow, move, unit);
    if (!place || sameList(place.queue, flow.queue)) return;
    if (shown.order === "priority") setPending({ kind: "priority", place, base: flow.queue, shown: flow.queue, waitsFor: [] });
    else land(place, flow.queue, flow.queue);
  };
  const drag = useCardDrag({ onDrop });
  const place = useMemo(() => (drag.move ? placeMove(shown, flow, drag.move, unit) : undefined), [drag.move, shown, flow, unit]);

  const switchOrder = () => {
    if (pending?.kind !== "priority") return;
    const { place: dropped, base } = pending;
    // GitHub's queue in Project order, which the switch makes the scheduler's.
    const projectQueue = layoutFlow({ ...shown, order: "project" }).queue;
    setPending(undefined);
    writes.switchToProject(() => land(dropped, base, projectQueue));
  };

  const ruleDrop: RuleBreakDrop | undefined =
    pending?.kind === "rule"
      ? {
          issue: pending.place.issue,
          queue: pending.base,
          index: pending.place.index,
          waitsFor: pending.waitsFor,
          pins: shown.pins,
          blockers,
          blocks: blocksOf(blockers),
        }
      : undefined;
  const choose = (queue: number[], choice: BreakChoice) => {
    if (pending?.kind !== "rule") return;
    setPending(undefined);
    writes.save(dropChange(pending.place.issue, pending.shown, queue, shown.pins, choice === "keep" ? { waitsFor: pending.waitsFor } : undefined));
  };

  return {
    input: shown,
    flow,
    drag,
    /** The card that moves, as it would land: while it drags, or while a dialog asks about its drop. */
    place: place ?? pending?.place,
    tip: place?.tip,
    asking: pending !== undefined,
    priority: pending?.kind === "priority",
    ruleDrop,
    switchOrder,
    choose,
    cancel: () => setPending(undefined),
    unpin: writes.unpin,
    applyOptimized: writes.applyOptimized,
    switchToProject: writes.switchToProject,
  };
}

/**
 * Optimize's preview (docs/plans/flow.md, Decision 11): while the person asks for it, the queue arranged over
 * the ticked items, or the whole queue, with the flow it gives and each moved task's old Next place. Pins and
 * tasks outside the selection keep their places. Under Priority order there is no preview: the order of the
 * tasks does not decide what starts.
 */
function useOptimizePreview(input: FlowInput, flow: Flow, selection: FlowSelectionControl | undefined, tree: SelectionTree) {
  const previewing = selection?.previewing ?? false;
  const picks = selection?.picks;
  return useMemo(() => {
    if (!previewing || !picks || input.order !== "project") return undefined;
    const result = optimize({ queue: flow.queue, tasks: input.tasks, minutes: input.minutes, priorityOptions: input.priorityOptions, pins: input.pins, scope: scopeOf(picks, tree) });
    return {
      ...result,
      before: flow.queue,
      flow: layoutFlow(reorderFlow(input, result.queue)),
      was: new Map(result.moved.map((m) => [m.issue, m.from])),
    };
  }, [previewing, picks, input, flow, tree]);
}

/** A Flow row's marks and tint: a search match, a head row's shade, and the hover tint of the lit story's rows. */
const rowLook = (row: TimelineRow, q: string, chained: boolean) => ({
  "data-match": (row.item && matchesQuery(row.item, q)) || undefined,
  "data-chain": chained || undefined,
  className: cn("absolute inset-x-0 flex", isHead(row) && "bg-muted/50", chained && "bg-active-dot/8"),
});

/**
 * The story chain of the hovered or focused card (issue #543), lit unless a card moves: the hover each card
 * takes, the pairs of cards that follow each other in the chain, and whether a row is the story's or one of its tasks'.
 */
function useChainHover(flow: Flow, moving: boolean) {
  const [hovered, setHovered] = useState<number>();
  const chain = hovered !== undefined && !moving ? chainPlace(flow.chains, hovered)?.chain : undefined;
  const hover: CardHover = {
    lit: chain && new Set(chain.issues),
    hovered,
    onHover: setHovered,
    storyOf: (issue) => {
      const at = chainPlace(flow.chains, issue);
      return at && { place: at.place, total: at.chain.issues.length, parent: at.chain.parent, next: at.next };
    },
  };
  return {
    hover,
    litPairs: pairsOf(chain?.issues ?? []),
    lighting: chain !== undefined,
    inChain: (row: TimelineRow) => chain !== undefined && (row.item?.number === chain.parent || row.task?.parent === chain.parent),
  };
}

/** Each task's open blockers turned around: the tasks each one blocks. */
function blocksOf(blockers: ReadonlyMap<number, readonly number[]>): Map<number, number[]> {
  const blocks = new Map<number, number[]>();
  for (const [issue, list] of blockers) for (const b of list) blocks.set(b, [...(blocks.get(b) ?? []), issue]);
  return blocks;
}

/**
 * The plan in order without dates (docs/plans/flow.md, Decisions 4 to 6 and 13): the tree's rows on the left,
 * and on the order axis each task's card on its row in the slot the scheduler would start it in, the slot
 * strips repeating every card, the Now line, the scheduler's hold, arrows from each blocker to what it blocks,
 * and unless the Legend's switch hides them, then arrows from each card to the next of its story (issue #543).
 * Lengths follow the sizes and only decide which slot frees first. A Ready card drags to a new place in the
 * order (Decisions 8 to 10).
 */
function FlowChart({ projectId, epics, unparented, flow: given, scheduler, graphs, graphName, searchOpen }: FlowProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const width = usePaneWidth(scroller);
  const rowsOpen = useRowsOpen(projectId, searchOpen);
  const q = useSearchQuery();
  const drops = useFlowDrops(projectId, given, width);
  const { input, place } = drops;
  const selection = useFlowSelection();
  const tree = useMemo(() => selectionTree(epics, unparented), [epics, unparented]);
  const tickOf = (row: TimelineRow): Tick | undefined => {
    if (!selection || !row.item) return undefined;
    const n = row.item.number;
    return {
      checked: isTicked(selection.picks, tree, n) || (isMixed(selection.picks, tree, n) && "indeterminate"),
      onClick: () => selection.setPicks(togglePick(selection.picks, tree, n)),
    };
  };
  const optimized = useOptimizePreview(input, drops.flow, selection, tree);
  // While a card moves or Optimize shows its preview, the flow shows the order it would give, on an axis that fits both.
  const flow = place?.flow ?? optimized?.flow ?? drops.flow;
  const axis = axisOf(flow !== drops.flow ? { cards: [...drops.flow.cards, ...flow.cards], end: Math.max(drops.flow.end, flow.end) } : flow, width);
  const cards = new Map(flow.cards.map((c) => [c.issue, c]));
  const tags = new Map(flow.rows.map((r) => [r.issue, r.tags]));
  const breaks = new Map(flow.breaks.map((b) => [b.issue, b.waitsFor]));
  const items = new Map<number, PlanItem>([...input.tasks.map((t) => [t.number, t] as const), ...itemsOf(epics, unparented)]);
  const { rows, height } = timelineRows(epics, unparented, rowsOpen.isOpen, () => 0);
  const { hover, litPairs, lighting, inChain } = useChainHover(flow, place !== undefined);
  const { arrows, then } = useArrows(flow, placer(rows, cards, axis), breaks, litPairs);
  const was = place && drops.flow.cards.find((c) => c.issue === place.issue);
  const landed = place && cards.get(place.issue);
  const drag: CardDrag = {
    // Cards do not drag while Optimize shows its preview.
    propsOf: (card) => (card.kind === "next" && !drops.asking && !optimized ? drops.drag.cardProps(card.issue) : undefined),
    moving: place && was ? { issue: place.issue, ghost: boxOf(axis, was), tip: drops.tip } : undefined,
    quiet: place !== undefined,
    onUnpin: drops.unpin,
    preview: optimized && {
      was: optimized.was,
      ghosts: new Map(drops.flow.cards.filter((c) => optimized.was.has(c.issue)).map((c) => [c.issue, boxOf(axis, c)])),
    },
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {optimized && selection && (
        <OptimizePreview
          moved={optimized.moved.length}
          kept={optimized.kept.length}
          scope={scopeName(selection.picks, tree)}
          selected={selection.picks.size > 0}
          onApply={() => {
            selection.setPreviewing(false);
            drops.applyOptimized(optimized.before, optimized.queue, { scope: scopeName(selection.picks, tree), moved: optimized.moved.length, kept: optimized.kept.length });
          }}
          onCancel={() => selection.setPreviewing(false)}
        />
      )}
      <div ref={scroller} className="overflow-x-auto overscroll-x-contain">
        <div role="grid" aria-label="Flow" aria-rowcount={rows.length + 1} className="relative text-[13px]" style={{ width: LABEL + axis.width, minWidth: "100%" }}>
          <div role="rowgroup">
            <LaneHeader flow={flow} axis={axis} order={input.order} scheduler={scheduler} lanes={input.lanes} />
          </div>
          <div role="rowgroup" className="relative" style={{ height }}>
            {/* Under the rows, so the hatch and the arrows pass behind the cards; the Now line stays on top. */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: LABEL, width: axis.width }}>
              <Past width={axis.now} />
              <ArrowLayer arrows={arrows} then={then} lighting={lighting} width={axis.width} height={height} />
              <span className="absolute inset-y-0 z-[3] w-0.5 -translate-x-1/2 bg-foreground/85" style={{ left: axis.now }} />
              {drops.tip && landed && <span data-drop-line className="absolute inset-y-0 z-[4] border-l-[1.5px] border-dashed border-foreground/60" style={{ left: axis.x(landed.start) }} />}
            </div>
            {rows.map((row) => (
              <div
                key={row.key}
                role="row"
                aria-label={rowLabel(row)}
                aria-expanded={row.expanded}
                {...rowLook(row, q, inChain(row))}
                style={{ top: row.top, height: row.height }}
              >
                <FlowRowLabel
                  row={row}
                  tags={(row.task && tags.get(row.task.number)) ?? []}
                  tick={tickOf(row)}
                  was={row.task && optimized?.was.get(row.task.number)}
                  projectId={projectId}
                  start={{ graphs, graphName }}
                  onToggle={() => rowsOpen.toggle(row.key)}
                  onUnpin={drops.unpin}
                />
                <div role="gridcell" className="relative flex-1 border-b" style={{ minWidth: axis.width }}>
                  {row.task ? (
                    <TaskCell task={row.task} row={row} flow={flow} axis={axis} cards={cards} tags={tags.get(row.task.number) ?? []} breaks={breaks} items={items} drag={drag} hover={hover} />
                  ) : (
                    row.item && <SpanCell item={row.item} cards={cards} axis={axis} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <PriorityOrderDialog open={drops.priority} onSwitch={drops.switchOrder} onCancel={drops.cancel} />
      {selection && (
        <PriorityOrderDialog
          open={selection.previewing && input.order === "priority"}
          asking="optimize"
          onSwitch={() => {
            // The preview opens once the scheduler orders by Project order.
            selection.setPreviewing(false);
            drops.switchToProject(() => selection.setPreviewing(true));
          }}
          onCancel={() => selection.setPreviewing(false)}
        />
      )}
      <RuleBreakDialog drop={drops.ruleDrop} titleOf={(n) => items.get(n)?.title} onMove={drops.choose} onCancel={drops.cancel} />
    </div>
  );
}

/** The Flow view: the chart, or under 640 px a list in order with each task's slot and Next tags. */
export function PlanFlow(props: FlowProps) {
  return useNarrow() ? <PlanFlowList {...props} /> : <FlowChart {...props} />;
}
