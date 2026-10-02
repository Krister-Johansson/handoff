import { daysBetween, shortDay } from "./plan/timeline-scale";

/** "Sep 30": the calendar day of an ISO time in UTC, as GitHub stamps it. */
export const dayOf = (iso: string) => shortDay(iso.slice(0, 10));

/** "14:08 UTC". */
export const utcTime = (at: Date) => `${at.toISOString().slice(11, 16)} UTC`;

/** "Oct 1, 22:17 UTC". */
export const utcStamp = (iso: string) => `${dayOf(iso)}, ${utcTime(new Date(iso))}`;

/** "14:08 UTC" on the day of `now`, else "Oct 1, 14:08 UTC". */
export const startedAt = (at: Date, now: Date) => (at.toISOString().slice(0, 10) === now.toISOString().slice(0, 10) ? utcTime(at) : utcStamp(at.toISOString()));

/** "Sep 30 to Oct 7", "from Sep 30" or "until Oct 7"; undefined without either date (YYYY-MM-DD). */
export function spanText(start: string | undefined, end: string | undefined): string | undefined {
  if (start && end) return `${shortDay(start)} to ${shortDay(end)}`;
  if (start) return `from ${shortDay(start)}`;
  if (end) return `until ${shortDay(end)}`;
  return undefined;
}

/** "in 28 days", "today", "3 days ago", from today to a day (YYYY-MM-DD). */
export function fromToday(day: string, today: string): string {
  const n = daysBetween(today, day);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n > 0) return `in ${n} days`;
  return n === -1 ? "yesterday" : `${-n} days ago`;
}
