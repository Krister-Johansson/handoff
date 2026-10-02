import type { PlanItem } from "@handoff/github";
import { formatDuration } from "./duration";
import { durationOf, type Duration, type Forecasts } from "./forecast";
import { endHour, stackBars, startHour, type BarTask, type PlannedSpan, type TimelineItem } from "./schedule";
import { overridden } from "./size-text";
import { addDays, longDay, shortDay } from "./timeline-scale";

/**
 * A move of a task on the timeline as a drag or the keys left it: whole days for its Start, a new manual
 * estimate in hours, or the day an unscheduled task is placed on.
 */
export type MoveDraft = { days: number; estimate?: number | undefined; place?: string | undefined };

/** A blocker the moved task starts before, with the day it ends. */
export type EarlyStart = { number: number; end: string };

/**
 * Where a move puts a task: the Start and Target to write (null clears), the manual estimate when the move set
 * one, its bar, and the blockers it starts before. Undo is a move back to the old values.
 */
export type MovePlan = {
  start: string | null;
  target: string | null;
  estimate?: number | null | undefined;
  span: PlannedSpan | undefined;
  startsBefore: EarlyStart[];
};

/** What a move needs to know of the plan: the person's hours a day, the forecasts, the items shown and every item's bar. */
export type MoveContext = {
  capacity: number | undefined;
  forecasts: Forecasts | undefined;
  items: ReadonlyMap<number, PlanItem>;
  entries: ReadonlyMap<number, TimelineItem>;
};

type Proposed = { proposal?: { size: PlanItem["size"] } | null };

/** A task's duration from its estimate, Size or the planner's proposal; undefined without forecasts. */
export function durationIn(ctx: Pick<MoveContext, "forecasts" | "capacity">, item: PlanItem & Proposed): Duration | undefined {
  if (!ctx.forecasts || ctx.capacity === undefined) return undefined;
  return durationOf(item, ctx.forecasts, item.proposal?.size ?? undefined);
}

const blockersOf = (item: PlanItem | undefined) => (item ? (item.blockers ?? item.blockedBy) : []);
const isDone = (item: PlanItem) => item.state === "closed" || item.status === "Done";

/** The blockers not done yet whose bar ends after a span starts, at the capacity per day. */
export function earlyStarts(ctx: MoveContext, item: PlanItem, span: PlannedSpan | undefined): EarlyStart[] {
  const capacity = ctx.capacity ?? 1;
  const starts = span && startHour(span, capacity);
  if (starts === undefined) return [];
  const openOutside = new Set(item.blockedBy);
  return blockersOf(item).flatMap((b) => {
    const blocker = ctx.items.get(b);
    const open = blocker ? !isDone(blocker) : openOutside.has(b);
    const bar = ctx.entries.get(b)?.planned;
    const ends = bar && endHour(bar, capacity);
    return open && bar && ends !== undefined && starts < ends - 1e-9 ? [{ number: b, end: bar.end }] : [];
  });
}

/**
 * Where a move puts a task. A task with a duration keeps it (or takes the new estimate) from its new Start,
 * after the tasks earlier in that day's order, and its Target is the day its hours end. A task with dates and
 * no duration moves both of them by the same days. Undefined when there is nothing to move.
 */
export function planMove(ctx: MoveContext, item: PlanItem & Proposed, draft: MoveDraft): MovePlan | undefined {
  const own = ctx.entries.get(item.number)?.planned;
  const hours = draft.estimate ?? durationIn(ctx, item)?.hours;
  if (hours !== undefined && ctx.capacity !== undefined) {
    const from = draft.place ?? own?.start ?? item.start;
    if (!from) return undefined;
    const start = draft.place ?? addDays(from, draft.days);
    const others = [...ctx.entries.values()].flatMap((e): BarTask[] =>
      e.number !== item.number && e.planned?.hours !== undefined ? [{ number: e.number, start: e.planned.start, blockers: blockersOf(ctx.items.get(e.number)), hours: e.planned.hours }] : [],
    );
    const span = stackBars([...others, { number: item.number, start, blockers: blockersOf(item), hours }], ctx.capacity).get(item.number)!;
    return { start, target: span.end, ...(draft.estimate !== undefined ? { estimate: draft.estimate } : {}), span, startsBefore: earlyStarts(ctx, item, span) };
  }
  if (draft.place) {
    const span = { start: draft.place, end: draft.place, openStart: false, openEnd: false };
    return { start: draft.place, target: draft.place, span, startsBefore: earlyStarts(ctx, item, span) };
  }
  if (!item.start && !item.target) return undefined;
  const start = item.start ? addDays(item.start, draft.days) : undefined;
  const target = item.target ? addDays(item.target, draft.days) : undefined;
  const span = { start: (start ?? target)!, end: (target ?? start)!, openStart: !start, openEnd: !target };
  return { start: start ?? null, target: target ?? null, span, startsBefore: earlyStarts(ctx, item, span) };
}

/** A task's own values as a move back to them: Undo, and where a refused write puts the bar. */
export function moveBack(item: PlanItem, entry: TimelineItem | undefined, plan: MovePlan): MovePlan {
  return {
    start: item.start ?? null,
    target: item.target ?? null,
    ...(plan.estimate !== undefined ? { estimate: item.estimate ?? null } : {}),
    span: entry?.planned,
    startsBefore: (entry?.startsBeforeBlocker ?? []).map((number) => ({ number, end: "" })),
  };
}

/** "M, forecast ~50m", "L, default ~2h", "M proposed, ~50m" or "Manual estimate 1.5d. Its size is M." */
function durationText(item: PlanItem, duration: Duration, capacity: number): string {
  const text = formatDuration(duration.hours, capacity);
  switch (duration.source) {
    case "estimate":
      return `Manual estimate ${text}.${item.size ? ` Its size is ${item.size}.` : ""}`;
    case "forecast":
      return `${item.size}, forecast ~${text}.`;
    case "default":
      return `${item.size}, default ~${text}.`;
    case "proposal":
      return `Proposed size, ~${text}.`;
  }
}

const days = (span: PlannedSpan) => (span.start === span.end ? longDay(span.start) : `${longDay(span.start)} to ${longDay(span.end)}`);

/** The drag's tooltip: the day it lands on, the duration with the Target that follows, and the blockers it starts before. */
export function moveTip(ctx: MoveContext, item: PlanItem & Proposed, draft: MoveDraft, plan: MovePlan, via: "pointer" | "keys"): { title: string; line: string; warnings: string[] } {
  const warnings = plan.startsBefore.map((b) => `Starts before #${b.number} ends on ${shortDay(b.end)}`);
  const span = plan.span!;
  const capacity = ctx.capacity ?? 1;
  const duration = durationIn(ctx, { ...item, ...(draft.estimate !== undefined ? { estimate: draft.estimate } : {}) });
  if (draft.estimate !== undefined && draft.days === 0) {
    const size = item.size && ctx.forecasts ? `Overrides ${overridden(ctx.forecasts[item.size], capacity)}. ` : "";
    const target = plan.target === item.target ? `Target stays ${shortDay(span.end)}.` : `Target moves to ${shortDay(span.end)}.`;
    return { title: `Manual estimate ${formatDuration(draft.estimate, capacity)}`, line: `${size}${target}`, warnings };
  }
  const what = duration ? `${durationText(item, duration, capacity)} ` : "";
  const then = via === "keys" ? "Saves when you stop pressing keys." : plan.target ? `Target ${shortDay(plan.target)}` : "";
  return { title: days(span), line: `${what}${then}`.trim(), warnings };
}
