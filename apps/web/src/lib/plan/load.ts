import type { PlanItem } from "@handoff/github";
import { sizedBars } from "./schedule";
import { addDays } from "./timeline-scale";

/** Hours a float may miss by and still count as whole. */
const EPSILON = 1e-9;

/**
 * The hours a bar puts on each day: it starts `offsetHours` into its Start day and every day holds the
 * capacity, so a bar past a day's end goes on into the next.
 */
export function spreadHours(start: string, offsetHours: number, hours: number, capacity: number): [day: string, hours: number][] {
  const spread: [string, number][] = [];
  const end = offsetHours + hours;
  for (let day = Math.floor(offsetHours / capacity + EPSILON); day * capacity < end - EPSILON; day++) {
    const used = Math.min(end, (day + 1) * capacity) - Math.max(offsetHours, day * capacity);
    if (used > EPSILON) spread.push([addDays(start, day), used]);
  }
  return spread;
}

/** The plan's load: planned hours per day, and the tasks with dates that add none for want of a duration. */
export type Load = { hours: Record<string, number>; datedWithoutDuration: number };

const isTask = (item: PlanItem) => item.kind !== "story" && item.kind !== "epic";

/**
 * Planned hours per day from every task with a duration and a Start, spread over the days its bar covers.
 * A task with dates and no duration adds no hours; it is counted so the load row can say so.
 */
export function loadByDay(items: readonly PlanItem[], durations: ReadonlyMap<number, { hours: number }>, capacity: number): Load {
  const hours: Record<string, number> = {};
  for (const bar of sizedBars(items, { durations, capacity }).values()) {
    for (const [day, used] of spreadHours(bar.start, bar.offsetHours ?? 0, bar.hours ?? 0, capacity)) hours[day] = (hours[day] ?? 0) + used;
  }
  const datedWithoutDuration = items.filter((i) => isTask(i) && !durations.has(i.number) && (i.start || i.target)).length;
  return { hours, datedWithoutDuration };
}
