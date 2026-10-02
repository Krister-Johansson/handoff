import type { DaySpan } from "./schedule";

/** How much time a column holds: a day of 96 px at Days, a day of 14 px at Weeks, a month of 120 px at Months. */
export type Zoom = "days" | "weeks" | "months";
/** The zooms the URL and the toolbar offer; Days joins them with the drag on the timeline. */
export const ZOOMS: readonly Zoom[] = ["weeks", "months"];

export const DAY_WIDTH = 14;
export const DAYS_DAY_WIDTH = 96;
export const MONTH_WIDTH = 120;

/** A header cell or a shaded column of the time axis, in pixels from the left of the time pane. */
export type AxisCell = { label: string; x: number; width: number };

export type TimeScale = {
  zoom: Zoom;
  /** The visible days, widened to whole ISO weeks or whole months. */
  range: DaySpan;
  width: number;
  /** The left edge of a day (YYYY-MM-DD). */
  x: (day: string) => number;
  /** Where an instant (ISO time) falls, by its calendar day and time of day in local time. */
  xAt: (iso: string) => number;
  /** Months at Days and Weeks, quarters at Months. */
  top: AxisCell[];
  /** Days ("Wed 30") at Days, ISO weeks at Weeks, months at Months. */
  bottom: AxisCell[];
  /** Saturday and Sunday pairs at Days and Weeks; none at Months. */
  weekends: AxisCell[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Days are calendar days; they are counted at UTC midnight so no time zone shifts them. */
const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayOfUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => dayOfUtc(utc(day) + n * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS);
/** Monday 0 to Sunday 6. */
const weekday = (day: string) => (new Date(utc(day)).getUTCDay() + 6) % 7;
const parts = (day: string) => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) - 1, date: Number(day.slice(8, 10)) });
const monthStart = (year: number, month: number) => dayOfUtc(Date.UTC(year, month, 1));
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The ISO week number of a day: weeks start on Monday and week 1 holds the year's first Thursday. */
function isoWeek(day: string): number {
  const thursday = addDays(day, 3 - weekday(day));
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(daysBetween(jan1, thursday) / 7) + 1;
}

/** "Oct 6", the short form the timeline writes dates in. */
export function shortDay(day: string): string {
  const { month, date } = parts(day);
  return `${MONTHS[month]} ${date}`;
}

/** The local calendar day of an instant, YYYY-MM-DD. */
export const dayOfInstant = (iso: string) => localDay(iso).day;

/** The local calendar day and the fraction of it gone of an instant. */
function localDay(iso: string): { day: string; fraction: number } {
  const at = new Date(iso);
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  const fraction = (at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds()) / 86400;
  return { day, fraction };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A column a day over whole ISO weeks: day cells at Days, week cells at Weeks, under month cells. */
function dayColumnsScale(span: DaySpan, zoom: "days" | "weeks"): TimeScale {
  const width = zoom === "days" ? DAYS_DAY_WIDTH : DAY_WIDTH;
  const range = { start: addDays(span.start, -weekday(span.start)), end: addDays(span.end, 6 - weekday(span.end)) };
  const days = daysBetween(range.start, range.end) + 1;
  const x = (day: string) => daysBetween(range.start, day) * width;
  const top: AxisCell[] = [];
  const bottom: AxisCell[] = [];
  const weekends: AxisCell[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(range.start, i);
    const { year, month, date } = parts(day);
    if (i === 0 || date === 1) {
      const end = Math.min(days, i + daysInMonth(year, month) - date + 1);
      top.push({ label: `${MONTHS[month]} ${year}`, x: i * width, width: (end - i) * width });
    }
    if (zoom === "days") bottom.push({ label: `${WEEKDAYS[weekday(day)]} ${date}`, x: i * width, width });
    else if (weekday(day) === 0) bottom.push({ label: `W${isoWeek(day)}`, x: i * width, width: 7 * width });
    if (weekday(day) === 5) weekends.push({ label: "Sat", x: i * width, width: 2 * width });
  }
  return {
    zoom,
    range,
    width: days * width,
    x,
    xAt: (iso) => {
      const { day, fraction } = localDay(iso);
      return x(day) + fraction * width;
    },
    top,
    bottom,
    weekends,
  };
}

function monthsScale(span: DaySpan): TimeScale {
  const first = parts(span.start);
  const last = parts(span.end);
  const count = (last.year - first.year) * 12 + last.month - first.month + 1;
  const range = { start: monthStart(first.year, first.month), end: addDays(monthStart(last.year, last.month + 1), -1) };
  const x = (day: string) => {
    const { year, month, date } = parts(day);
    const index = (year - first.year) * 12 + month - first.month;
    return index * MONTH_WIDTH + ((date - 1) / daysInMonth(year, month)) * MONTH_WIDTH;
  };
  const bottom: AxisCell[] = [];
  const top: AxisCell[] = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.UTC(first.year, first.month + i, 1));
    const month = at.getUTCMonth();
    bottom.push({ label: MONTHS[month]!, x: i * MONTH_WIDTH, width: MONTH_WIDTH });
    if (i === 0 || month % 3 === 0) {
      const left = Math.min(count - i, 3 - (month % 3));
      top.push({ label: `Q${Math.floor(month / 3) + 1} ${at.getUTCFullYear()}`, x: i * MONTH_WIDTH, width: left * MONTH_WIDTH });
    }
  }
  return {
    zoom: "months",
    range,
    width: count * MONTH_WIDTH,
    x,
    xAt: (iso) => {
      const { day, fraction } = localDay(iso);
      const { year, month } = parts(day);
      return x(day) + (fraction / daysInMonth(year, month)) * MONTH_WIDTH;
    },
    top,
    bottom,
    weekends: [],
  };
}

const MIN_DAYS = 8 * 7;

/**
 * The days the chart shows: from a week before the earliest Start (or today) to two weeks after the
 * latest Target (or today). A range shorter than eight weeks opens two weeks before today and runs eight weeks.
 */
export function visibleRange(spans: readonly DaySpan[], today: string): DaySpan {
  const starts = [today, ...spans.map((s) => s.start)].sort();
  const ends = [today, ...spans.map((s) => s.end)].sort();
  let start = addDays(starts[0]!, -7);
  let end = addDays(ends.at(-1)!, 14);
  if (daysBetween(start, end) + 1 < MIN_DAYS) {
    const early = addDays(today, -14);
    if (early < start) start = early;
    const late = addDays(start, MIN_DAYS - 1);
    if (late > end) end = late;
  }
  return { start, end };
}

/** Weeks while the range is under ten weeks, Months beyond. */
export const defaultZoom = (range: DaySpan): Zoom => (daysBetween(range.start, range.end) + 1 < 10 * 7 ? "weeks" : "months");

/** The time axis over a span of days at a zoom, widened to whole weeks or whole months. */
export function timeScale(span: DaySpan, zoom: Zoom): TimeScale {
  return zoom === "months" ? monthsScale(span) : dayColumnsScale(span, zoom);
}
