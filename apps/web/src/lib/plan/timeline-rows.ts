import type { PlanItem, PlanProject } from "@handoff/github";
import type { PlanEpic, PlanProgress, PlanTask } from "@/server/plan";
import type { ActualStrip, DaySpan, Timeline, TimelineItem } from "./schedule";
import { dayOfInstant, shortDay, visibleRange } from "./timeline-scale";

export const KIND_NAME = { epic: "Epic", story: "Story", task: "Task", group: "Unparented" } as const;

/** An epic's or a story's progress, when the item carries it. */
export const progressOf = (item: unknown): PlanProgress | undefined => (item && typeof item === "object" && "progress" in item ? (item.progress as PlanProgress) : undefined);

/** "Oct 1 to now" for an active run, "Sep 26 to Sep 30" for one that ended. */
export const stripDates = (strip: ActualStrip) => `${shortDay(dayOfInstant(strip.start))} to ${strip.active ? "now" : shortDay(dayOfInstant(strip.end))}`;

/** The local clock time of an instant, 24 hours: "14:05". */
const clockOf = (iso: string) => {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
};

/** "Oct 2, 12:20 to now", "Oct 1, 10:00 to 11:00", or with the end's day when it ended on another day. */
export function stripClock(strip: ActualStrip): string {
  const startDay = dayOfInstant(strip.start);
  const from = `${shortDay(startDay)}, ${clockOf(strip.start)}`;
  if (strip.active) return `${from} to now`;
  const endDay = dayOfInstant(strip.end);
  return `${from} to ${endDay === startDay ? "" : `${shortDay(endDay)}, `}${clockOf(strip.end)}`;
}

/** Whether the Project lacks Start or Target. */
export const lacksDateFields = (project: PlanProject) => !project.dateFields?.start || !project.dateFields.target;

/**
 * What the Project lacks of Size and Estimate, as the banner's title says it; undefined when it has both with
 * S, M and L, or when the Project was built without reading them.
 */
export function estimateFieldsGap(project: PlanProject): string | undefined {
  const fields = project.estimateFields;
  if (!fields) return undefined;
  if (!fields.size) return fields.estimate ? "This Project has no Size field" : "This Project has no Size and no Estimate field";
  const lacking = (["S", "M", "L"] as const).filter((s) => !fields.size?.options[s]);
  // "S, M or L": the options GitHub's Size field lacks, its own options kept.
  const options = lacking.length ? `The Size field has no ${[lacking.slice(0, -1).join(", "), lacking.at(-1)].filter(Boolean).join(" or ")} option` : undefined;
  if (fields.estimate) return options;
  return options ? `${options}, and the Project has no Estimate field` : "This Project has no Estimate field";
}

/** "Oct 6 to Oct 17", or one day alone. */
export const spanText = (span: DaySpan) => (span.start === span.end ? shortDay(span.start) : `${shortDay(span.start)} to ${shortDay(span.end)}`);

/** The days the chart shows: every planned or derived span and every run strip, around today. */
export function chartRange(timeline: Timeline): DaySpan {
  const spans = timeline.items.flatMap((i) => [
    ...[i.planned ?? i.derived].filter((s) => s !== undefined),
    ...i.actual.map((a) => ({ start: dayOfInstant(a.start), end: dayOfInstant(a.end) })),
  ]);
  return visibleRange(spans, timeline.today);
}

/** Every epic, story and task of the plan as shown, by number. */
export const itemsOf = (epics: PlanEpic[], unparented: PlanTask[]) =>
  new Map<number, PlanItem>([...epics.flatMap((e) => [e, ...e.stories, ...e.stories.flatMap((s) => s.tasks), ...e.tasks]), ...unparented].map((i) => [i.number, i]));

/** A line under the schedule dialog's fields: the parent's window, or a blocker and when it is planned to end. */
export type ScheduleNote = { kind: "window" | "blocker"; text: string };

/** What the schedule dialog tells about an item: the nearest parent's span, then each open blocker's planned end. */
export function scheduleNotes(item: PlanItem, items: Map<number, PlanItem>, entries: Map<number, TimelineItem>): ScheduleNote[] {
  const notes: ScheduleNote[] = [];
  const seen = new Set<number>();
  for (let p = item.parent; p !== undefined && !seen.has(p); p = items.get(p)?.parent) {
    seen.add(p);
    const parent = items.get(p);
    const entry = entries.get(p);
    const span = entry?.planned ?? entry?.derived;
    if (!parent || !span) continue;
    const name = `${parent.kind === "story" ? "Story" : "Epic"} #${parent.number} ${parent.title}`;
    notes.push({ kind: "window", text: entry?.planned ? `${name} runs ${spanText(span)}.` : `${name} spans ${spanText(span)}, derived from its tasks.` });
    break;
  }
  for (const blocker of entries.get(item.number)?.waitingOn ?? []) {
    const end = entries.get(blocker)?.planned?.end;
    notes.push({ kind: "blocker", text: end ? `Blocked by #${blocker}, planned to end ${shortDay(end)}.` : `Blocked by #${blocker}, not scheduled.` });
  }
  return notes;
}

export type TimelineRowKind = "epic" | "story" | "task" | "group";

/** One row of the timeline: an epic, a story, a task, or the heading of the Unparented group. */
export type TimelineRow = {
  /** The collapse key for epics, stories and the group (e12, s41, unparented); t57 for a task. */
  key: string;
  kind: TimelineRowKind;
  /** The plan item; undefined for the Unparented heading. */
  item: PlanItem | undefined;
  /** Set on task rows. */
  task: PlanTask | undefined;
  /** 1 for epics and the group heading, 2 for stories and loose tasks, 3 for tasks under a story. */
  level: 1 | 2 | 3;
  /** Open or collapsed, for rows that hold others. */
  expanded: boolean | undefined;
  top: number;
  height: number;
};

export const HEIGHT = { epic: 36, story: 34, group: 36, task: 46 } as const;
/** A task row grows with its run strips: 6 px each and a 2 px gap under the 20 px bar. */
export const taskHeight = (strips: number) => Math.max(HEIGHT.task, 31 + strips * 8);

/**
 * The timeline's rows in the tree's order with their offsets, and for every item the visible row that
 * stands for it: its own, or the collapsed epic or story it hides in.
 */
export function timelineRows(epics: PlanEpic[], unparented: PlanTask[], isOpen: (key: string) => boolean, stripsOf: (number: number) => number) {
  const rows: TimelineRow[] = [];
  const anchor = new Map<number, TimelineRow>();
  let top = 0;
  const push = (row: Omit<TimelineRow, "top">) => {
    const placed = { ...row, top };
    rows.push(placed);
    top += row.height;
    if (row.item) anchor.set(row.item.number, placed);
    return placed;
  };
  const hide = (items: PlanItem[], under: TimelineRow) => items.forEach((i) => anchor.set(i.number, under));
  const taskRow = (task: PlanTask, level: 2 | 3) =>
    push({ key: `t${task.number}`, kind: kindOf(task), item: task, task, level, expanded: undefined, height: taskHeight(stripsOf(task.number)) });

  for (const epic of epics) {
    const key = `e${epic.number}`;
    const open = isOpen(key);
    const row = push({ key, kind: "epic", item: epic, task: undefined, level: 1, expanded: open, height: HEIGHT.epic });
    if (!open) {
      hide([...epic.stories, ...epic.stories.flatMap((s) => s.tasks), ...epic.tasks], row);
      continue;
    }
    for (const story of epic.stories) {
      const storyKey = `s${story.number}`;
      const storyOpen = isOpen(storyKey);
      const storyRow = push({ key: storyKey, kind: "story", item: story, task: undefined, level: 2, expanded: storyOpen, height: HEIGHT.story });
      if (storyOpen) story.tasks.forEach((t) => taskRow(t, 3));
      else hide(story.tasks, storyRow);
    }
    epic.tasks.forEach((t) => taskRow(t, 2));
  }
  if (unparented.length > 0) {
    const open = isOpen("unparented");
    const row = push({ key: "unparented", kind: "group", item: undefined, task: undefined, level: 1, expanded: open, height: HEIGHT.group });
    if (open) unparented.forEach((t) => taskRow(t, 2));
    else hide(unparented, row);
  }
  return { rows, anchor, height: top };
}

/** Where an item sits on the chart: its row, and the left and right edge of its bar or, without one, its strips. */
export type Placed = { row: TimelineRow; own: boolean; left: number; right: number; y: number };

/** The bar's middle: task bars sit 6 px down and are 20 px tall; neutral bars 10 px down and 15 px tall. */
const barMiddle = (row: TimelineRow) => row.top + (row.kind === "task" ? 16 : 17.5);

/**
 * An item's place for the arrows: on its own row at its bar (or its first strip when it has no bar),
 * or, inside a collapsed epic or story, at the middle of that row at the item's own time.
 */
export function placeItem(
  number: number,
  anchor: Map<number, TimelineRow>,
  bar: (number: number) => { left: number; right: number } | undefined,
  strips: (number: number) => { left: number; right: number } | undefined,
): Placed | undefined {
  const row = anchor.get(number);
  if (!row) return undefined;
  const own = row.item?.number === number;
  const planned = bar(number);
  const at = planned ?? strips(number);
  if (!at) return undefined;
  const y = !own ? row.top + row.height / 2 : planned ? barMiddle(row) : row.top + 32;
  return { row, own, ...at, y };
}

/**
 * An orthogonal path from the right edge of the blocker to the left edge of the blocked item. When the
 * blocked item starts before the blocker ends, the path turns back along the edge of the blocked row.
 */
export function arrowPath(from: Placed, to: Placed): string {
  const x1 = from.right;
  const x2 = to.left;
  const out = x1 + 6;
  if (x2 - 10 >= out) return `M${x1} ${from.y} H${out} V${to.y} H${x2 - 4}`;
  const turn = to.y > from.y ? to.row.top + 3 : to.row.top + to.row.height - 3;
  return `M${x1} ${from.y} H${out} V${turn} H${x2 - 10} V${to.y} H${x2 - 4}`;
}

/** A loose item keeps its own kind; anything that is neither an epic nor a story is drawn as a task. */
const kindOf = (item: PlanItem): TimelineRowKind => (item.kind === "story" || item.kind === "epic" ? item.kind : "task");
