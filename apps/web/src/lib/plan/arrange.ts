import { spreadHours } from "./load";
import { endHour, inBlockerOrder, stackBars, startHour, type BarTask, type PlannedSpan } from "./schedule";
import { addDays } from "./timeline-scale";

/**
 * A task as Arrange sees it: the issues that block it, its dates when it has them, and its duration in hours
 * (undefined without a size or an estimate).
 */
export type ArrangeTask = { number: number; blockers: readonly number[]; start?: string | undefined; target?: string | undefined; hours: number | undefined };

export type Placement = { issue: number; start: string; target: string };
/** Where Arrange puts each task, and the tasks it cannot place: "no-duration" has neither a size nor an estimate. */
export type Arrangement = { placements: Placement[]; leftOut: { issue: number; reason: "no-duration" }[] };

/** Hours a float may miss by and still count as whole. */
const EPSILON = 1e-9;
/** How far Arrange looks for a day with room before it gives up on a task. */
const HORIZON_DAYS = 3650;

/** Planned hours per day of a set of bars. */
function loadOf(bars: ReturnType<typeof stackBars>, capacity: number): Map<string, number> {
  const load = new Map<string, number>();
  for (const bar of bars.values()) for (const [day, used] of spreadHours(bar.start, bar.offsetHours ?? 0, bar.hours ?? 0, capacity)) load.set(day, (load.get(day) ?? 0) + used);
  return load;
}

/**
 * Places unscheduled tasks from today: in blocker order, then by number, each on the first day where its bar
 * starts that day, adds no hours to a day beyond the capacity, and moves no planned bar. Planned work, hidden
 * by filters or not, keeps its dates. Each Target is the day the task's bar ends, as the timeline lays it out.
 */
export function arrange(tasks: readonly ArrangeTask[], planned: readonly ArrangeTask[], capacity: number, today: string): Arrangement {
  const fixed = planned.flatMap((t): BarTask[] => (t.start && t.hours !== undefined ? [{ number: t.number, start: t.start, target: t.target, blockers: t.blockers, hours: t.hours }] : []));
  const fixedBars = stackBars(fixed, capacity);
  const placed: BarTask[] = [];

  // Planned tasks without a duration end with their Target day; with only a Start their end is unknown.
  const datedEnds = new Map(
    planned.flatMap((t) => {
      const span: PlannedSpan | undefined = t.target ? { start: t.start ?? t.target, end: t.target, openStart: !t.start, openEnd: false } : undefined;
      return t.hours === undefined && span ? [[t.number, endHour(span, capacity)!] as const] : [];
    }),
  );

  const fits = (candidate: BarTask) => {
    const before = stackBars([...fixed, ...placed], capacity);
    const after = stackBars([...fixed, ...placed, candidate], capacity);
    const bar = after.get(candidate.number)!;
    if ((bar.offsetHours ?? 0) >= capacity - EPSILON) return false;
    const starts = startHour(bar, capacity)!;
    for (const blocker of candidate.blockers) {
      const blockerBar = after.get(blocker);
      const ends = blockerBar ? endHour(blockerBar, capacity) : datedEnds.get(blocker);
      if (ends !== undefined && starts < ends - EPSILON) return false;
    }
    for (const [number, bar] of fixedBars) if (after.get(number)!.offsetHours !== bar.offsetHours) return false;
    const was = loadOf(before, capacity);
    for (const [day, hours] of loadOf(after, capacity)) if (hours > (was.get(day) ?? 0) + EPSILON && hours > capacity + EPSILON) return false;
    return true;
  };

  for (const task of inBlockerOrder(tasks.filter((t) => t.hours !== undefined))) {
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const candidate = { number: task.number, start: addDays(today, i), blockers: task.blockers, hours: task.hours! };
      if (!fits(candidate)) continue;
      placed.push(candidate);
      break;
    }
  }
  const bars = stackBars([...fixed, ...placed], capacity);
  return {
    placements: placed.map((t) => ({ issue: t.number, start: t.start, target: bars.get(t.number)!.end })),
    leftOut: tasks.filter((t) => t.hours === undefined).map((t) => ({ issue: t.number, reason: "no-duration" as const })),
  };
}
