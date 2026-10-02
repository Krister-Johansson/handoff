import type { PlanItem } from "@handoff/github";

/** A run as the timeline draws it: the issues it linked and when it ran (ISO times; null until it started or finished). */
export type TimelineRun = { id: string; status: string; issues: number[]; startedAt: string | null; finishedAt: string | null };

/** A span of days, YYYY-MM-DD, both ends included. */
export type DaySpan = { start: string; end: string };
/**
 * An item's own dates. With only one of Start and Target it is one day long, open on the missing side. A task
 * with a duration and a Start runs from its Start for its hours at the capacity per day instead, starting
 * `offsetHours` into its first day, and keeps a Target on GitHub that disagrees as `targetOnGitHub`.
 */
export type PlannedSpan = DaySpan & { openStart: boolean; openEnd: boolean; hours?: number; offsetHours?: number; targetOnGitHub?: string };

/** How long tasks take in hours, by issue number, and the person's hours of work a day. */
export type SpanOptions = { durations: ReadonlyMap<number, { hours: number }>; capacity: number };
/** The time one run worked on a task, from its start to its end (to now while active), as ISO times. */
export type ActualStrip = { runId: string; status: string; start: string; end: string; active: boolean };

export type TimelineItem = {
  number: number;
  /** The item's own Start and Target; undefined when it has neither. */
  planned: PlannedSpan | undefined;
  /** A story's or an epic's span without dates of its own: earliest Start to latest Target of its descendants. */
  derived: DaySpan | undefined;
  /** One strip per run that linked the item, newest first. */
  actual: ActualStrip[];
  /** The blockers that are not done yet. */
  waitingOn: number[];
  /** Today is past its Start and a blocker is not done. */
  late: boolean;
  /** Days past its Target on GitHub while not done; undefined when it is not overdue or is over forecast. */
  overdueDays: number | undefined;
  /** Minutes an active run has gone past the task's duration; undefined without an active run past it. */
  overForecastMinutes: number | undefined;
  /** The blockers not done yet whose bar ends after this item's bar starts. */
  startsBeforeBlocker: number[];
  /** Its own span leaves the own dates of its nearest ancestor that has both. */
  outsideParent: boolean;
  /** Neither its own dates nor a derived span place it on the chart. */
  unscheduled: boolean;
};

/** A dependency: `from` blocks `to`. Red (late) when the blocked item is late. */
export type TimelineArrow = { from: number; to: number; late: boolean };

export type Timeline = { today: string; items: TimelineItem[]; arrows: TimelineArrow[] };

const ACTIVE = new Set(["queued", "running", "waiting"]);
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day of an instant in local time, YYYY-MM-DD. */
const dayOf = (at: Date) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
/** Whole days from one YYYY-MM-DD to another. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** Hours a float may miss by and still count as whole. */
const EPSILON = 1e-9;

/** A closed item is done whatever its Status says. */
const isDone = (item: Pick<PlanItem, "state" | "status">) => item.state === "closed" || item.status === "Done";

function plannedOf(item: PlanItem): PlannedSpan | undefined {
  const { start, target } = item;
  if (start && target) return { start, end: target, openStart: false, openEnd: false };
  if (start) return { start, end: start, openStart: false, openEnd: true };
  if (target) return { start: target, end: target, openStart: true, openEnd: false };
  return undefined;
}

/**
 * A task's bar from its Start for its hours at the capacity per day, starting `offsetHours` into its first day.
 * Its end is the day its last hour falls on; every day counts.
 */
function barOf(item: PlanItem, hours: number, offsetHours: number, capacity: number): PlannedSpan {
  const start = item.start!;
  const end = addDays(start, Math.max(0, Math.ceil((offsetHours + hours) / capacity - EPSILON) - 1));
  return { start, end, openStart: false, openEnd: false, hours, offsetHours, ...(item.target && item.target !== end ? { targetOnGitHub: item.target } : {}) };
}

/**
 * Tasks with each one after the blockers among them, and otherwise by issue number. Blockers that form a
 * loop fall back to number order.
 */
export function inBlockerOrder<T extends { number: number; blockers: readonly number[] }>(tasks: readonly T[]): T[] {
  const pending = new Map(tasks.map((t) => [t.number, t]));
  const ordered: T[] = [];
  while (pending.size) {
    const free = [...pending.values()].filter((t) => !t.blockers.some((b) => b !== t.number && pending.has(b)));
    const next = (free.length ? free : [...pending.values()]).reduce((a, b) => (b.number < a.number ? b : a));
    ordered.push(next);
    pending.delete(next.number);
  }
  return ordered;
}

/** Every blocker GitHub links, open or closed. */
const blockersOf = (item: PlanItem) => item.blockers ?? item.blockedBy;

/**
 * The bars of the tasks with a duration and a Start. The tasks that start on one day sit one after another
 * in blocker order, then by number, so a later task starts after the hours of the ones before it.
 */
export function sizedBars(items: readonly PlanItem[], opts: SpanOptions): Map<number, PlannedSpan> {
  const byDay = new Map<string, { number: number; blockers: number[]; item: PlanItem; hours: number }[]>();
  for (const item of items) {
    const duration = opts.durations.get(item.number);
    if (!duration || !item.start) continue;
    byDay.set(item.start, [...(byDay.get(item.start) ?? []), { number: item.number, blockers: blockersOf(item), item, hours: duration.hours }]);
  }
  const bars = new Map<number, PlannedSpan>();
  for (const day of byDay.values()) {
    let used = 0;
    for (const task of inBlockerOrder(day)) {
      bars.set(task.number, barOf(task.item, task.hours, used, opts.capacity));
      used += task.hours;
    }
  }
  return bars;
}

/** Hours from the start of 1970-01-01 to `offsetHours` into a day, at the capacity per day. */
const hourOf = (day: string, offsetHours: number, capacity: number) => daysBetween("1970-01-01", day) * capacity + offsetHours;
/** Where a bar starts, in hours: a sized bar after its offset, a dated one at the start of its Start day. */
const startHour = (span: PlannedSpan, capacity: number) => (span.openStart ? undefined : hourOf(span.start, span.offsetHours ?? 0, capacity));
/** Where a bar ends, in hours: a sized bar after its hours, a dated one at the end of its Target day. */
const endHour = (span: PlannedSpan, capacity: number) =>
  span.hours !== undefined ? hourOf(span.start, (span.offsetHours ?? 0) + span.hours, capacity) : span.openEnd ? undefined : hourOf(addDays(span.end, 1), 0, capacity);

/** Minutes the newest active run has worked past the duration; undefined while inside it or without either. */
function overForecastOf(strips: ActualStrip[], duration: { hours: number } | undefined, now: Date): number | undefined {
  const active = strips.find((s) => s.active);
  if (!active || !duration) return undefined;
  const over = Math.round((now.getTime() - Date.parse(active.start)) / 60_000 - duration.hours * 60);
  return over > 0 ? over : undefined;
}

/**
 * Where each item of a plan sits in time: its planned span from the Project's Start and Target, a
 * derived span for a story or an epic without dates, the actual strips of the runs that linked it,
 * whether it is late (Start passed, a blocker not done) or overdue (Target passed, not done), and the
 * dependency arrows from blocked-by links. With durations, a task's bar runs from its Start for its
 * hours at the capacity, and an active run past the duration is over forecast instead of overdue.
 * Nothing here is stored; `now` decides today.
 */
export function deriveSpans(items: PlanItem[], runs: TimelineRun[], now: Date, opts?: SpanOptions): Timeline {
  const today = dayOf(now);
  const byNumber = new Map(items.map((i) => [i.number, i]));
  const bars = opts ? sizedBars(items, opts) : new Map<number, PlannedSpan>();
  // A task with a duration runs from its Start; without one it waits in Unscheduled whatever its Target says.
  const planned = new Map(items.map((i) => [i.number, opts?.durations.has(i.number) ? bars.get(i.number) : plannedOf(i)]));
  const children = new Map<number, PlanItem[]>();
  for (const i of items) if (i.parent !== undefined && byNumber.has(i.parent)) children.set(i.parent, [...(children.get(i.parent) ?? []), i]);

  const descendantSpans = (number: number, seen = new Set<number>()): PlannedSpan[] =>
    (children.get(number) ?? []).flatMap((child) => {
      if (seen.has(child.number)) return [];
      seen.add(child.number);
      const own = planned.get(child.number);
      return [...(own ? [own] : []), ...descendantSpans(child.number, seen)];
    });
  const derivedOf = (item: PlanItem): DaySpan | undefined => {
    if (item.kind === "task" || planned.get(item.number)) return undefined;
    const spans = descendantSpans(item.number);
    const starts = spans.filter((s) => !s.openStart).map((s) => s.start);
    const ends = spans.filter((s) => !s.openEnd).map((s) => s.end);
    if (!spans.length) return undefined;
    const start = (starts.length ? starts : spans.map((s) => s.start)).sort()[0]!;
    const end = (ends.length ? ends : spans.map((s) => s.end)).sort().at(-1)!;
    return { start, end };
  };
  /** The own dates of the nearest ancestor with both a Start and a Target. */
  const windowOf = (item: PlanItem): DaySpan | undefined => {
    const seen = new Set<number>();
    for (let p = item.parent; p !== undefined && !seen.has(p); p = byNumber.get(p)?.parent) {
      seen.add(p);
      const span = planned.get(p);
      if (span && !span.openStart && !span.openEnd) return span;
    }
    return undefined;
  };

  const stripsOf = new Map<number, ActualStrip[]>();
  for (const run of runs) {
    if (!run.startedAt) continue;
    const active = ACTIVE.has(run.status);
    const strip = { runId: run.id, status: run.status, start: run.startedAt, end: run.finishedAt ?? now.toISOString(), active };
    for (const issue of run.issues) if (byNumber.has(issue)) stripsOf.set(issue, [...(stripsOf.get(issue) ?? []), strip]);
  }

  const timelineItems = items.map((item): TimelineItem => {
    const own = planned.get(item.number);
    const derived = derivedOf(item);
    // A blocker in the plan is done when closed or in Done; one outside it while GitHub lists it as open.
    const waitingOn = blockersOf(item).filter((b) => {
      const blocker = byNumber.get(b);
      return blocker ? !isDone(blocker) : item.blockedBy.includes(b);
    });
    const done = isDone(item);
    const late = !done && item.start !== undefined && today > item.start && waitingOn.length > 0;
    const actual = (stripsOf.get(item.number) ?? []).sort((a, b) => b.start.localeCompare(a.start));
    const overForecastMinutes = overForecastOf(actual, opts?.durations.get(item.number), now);
    const overdueDays = !done && overForecastMinutes === undefined && item.target !== undefined && today > item.target ? daysBetween(item.target, today) : undefined;
    const window = own ? windowOf(item) : undefined;
    const capacity = opts?.capacity ?? 1;
    const starts = own && startHour(own, capacity);
    const startsBeforeBlocker = blockersOf(item).filter((b) => {
      const blocker = byNumber.get(b);
      const span = planned.get(b);
      const ends = span && endHour(span, capacity);
      return blocker !== undefined && !isDone(blocker) && starts !== undefined && ends !== undefined && starts < ends - EPSILON;
    });
    return {
      number: item.number,
      planned: own,
      derived,
      actual,
      waitingOn,
      late,
      overdueDays,
      overForecastMinutes,
      startsBeforeBlocker,
      outsideParent: own !== undefined && window !== undefined && (own.start < window.start || own.end > window.end),
      unscheduled: !own && !derived,
    };
  });
  const lateOf = new Map(timelineItems.map((i) => [i.number, i.late]));
  const arrows = items.flatMap((item) =>
    blockersOf(item).filter((b) => byNumber.has(b)).map((from) => ({ from, to: item.number, late: lateOf.get(item.number) ?? false })),
  );
  return { today, items: timelineItems, arrows };
}
