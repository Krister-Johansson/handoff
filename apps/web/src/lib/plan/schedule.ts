import type { PlanItem } from "@handoff/github";

/** A run as the timeline draws it: the issues it linked and when it ran (ISO times; null until it started or finished). */
export type TimelineRun = { id: string; status: string; issues: number[]; startedAt: string | null; finishedAt: string | null };

/** A span of days, YYYY-MM-DD, both ends included. */
export type DaySpan = { start: string; end: string };
/** An item's own dates. With only one of Start and Target it is one day long, open on the missing side. */
export type PlannedSpan = DaySpan & { openStart: boolean; openEnd: boolean };
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
  /** Days past its Target while not done; undefined when it is not overdue. */
  overdueDays: number | undefined;
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
 * Where each item of a plan sits in time: its planned span from the Project's Start and Target, a
 * derived span for a story or an epic without dates, the actual strips of the runs that linked it,
 * whether it is late (Start passed, a blocker not done) or overdue (Target passed, not done), and the
 * dependency arrows from blocked-by links. Nothing here is stored; `now` decides today.
 */
export function deriveSpans(items: PlanItem[], runs: TimelineRun[], now: Date): Timeline {
  const today = dayOf(now);
  const byNumber = new Map(items.map((i) => [i.number, i]));
  const planned = new Map(items.map((i) => [i.number, plannedOf(i)]));
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
    const blockers = item.blockers ?? item.blockedBy;
    // A blocker in the plan is done when closed or in Done; one outside it while GitHub lists it as open.
    const waitingOn = blockers.filter((b) => {
      const blocker = byNumber.get(b);
      return blocker ? !isDone(blocker) : item.blockedBy.includes(b);
    });
    const done = isDone(item);
    const late = !done && item.start !== undefined && today > item.start && waitingOn.length > 0;
    const overdueDays = !done && item.target !== undefined && today > item.target ? daysBetween(item.target, today) : undefined;
    const window = own ? windowOf(item) : undefined;
    return {
      number: item.number,
      planned: own,
      derived,
      actual: (stripsOf.get(item.number) ?? []).sort((a, b) => b.start.localeCompare(a.start)),
      waitingOn,
      late,
      overdueDays,
      outsideParent: own !== undefined && window !== undefined && (own.start < window.start || own.end > window.end),
      unscheduled: !own && !derived,
    };
  });
  const lateOf = new Map(timelineItems.map((i) => [i.number, i.late]));
  const arrows = items.flatMap((item) =>
    (item.blockers ?? item.blockedBy).filter((b) => byNumber.has(b)).map((from) => ({ from, to: item.number, late: lateOf.get(item.number) ?? false })),
  );
  return { today, items: timelineItems, arrows };
}
