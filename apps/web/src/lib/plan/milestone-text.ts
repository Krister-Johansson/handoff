import type { Milestone } from "@handoff/github";
import { fromToday } from "../issue-dates";
import type { MilestoneProgress } from "./milestones";
import { shortDay } from "./timeline-scale";

/** "Due Oct 20, in 15 days", "Due Oct 3, 2 days ago", or "No due date". */
export const dueText = (milestone: Pick<Milestone, "dueOn">, today: string) => (milestone.dueOn ? `Due ${shortDay(milestone.dueOn)}, ${fromToday(milestone.dueOn, today)}` : "No due date");

/** "Due Oct 20", or nothing without a due date: the picker's short form. */
export const dueShort = (milestone: Pick<Milestone, "dueOn">) => (milestone.dueOn ? `Due ${shortDay(milestone.dueOn)}` : undefined);

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** How the plan mode judges a milestone, in one line: late in danger, on time or early in success, else plain. */
export type MilestoneLine = { text: string; tone: "late" | "ok" | "plain" };

/**
 * The plan mode's line for a milestone. In Flow mode, which has no dates, where its last task sits in the order
 * ("Ends after Next 6") and never a day. In Timeline mode, the latest Target of its tasks against the due date
 * ("Ends Oct 4, 1 day late", "Ends Oct 1, 3 days early", "Ends Oct 3, on the due date").
 */
export function milestoneLine(progress: MilestoneProgress): MilestoneLine {
  if (progress.total === 0) return { text: "No tasks in it yet", tone: "plain" };
  if (progress.done === progress.total) return { text: "Every task done", tone: "ok" };
  if (progress.flow) return { text: progress.flow.last ? `Ends after Next ${progress.flow.last.place}` : "None of its open tasks is in the order", tone: "plain" };
  const timeline = progress.timeline;
  if (!timeline?.ends) return { text: "No task has dates yet", tone: "plain" };
  const ends = `Ends ${shortDay(timeline.ends)}`;
  const past = timeline.daysPastDue;
  if (past === undefined) return { text: ends, tone: "plain" };
  if (past > 0) return { text: `${ends}, ${days(past)} late`, tone: "late" };
  return { text: past < 0 ? `${ends}, ${days(-past)} early` : `${ends}, on the due date`, tone: "ok" };
}

const andList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** "#152 has no dates", "#160 and #161 have no dates": the Timeline's open tasks it cannot place, named and not counted. */
export const undatedText = (undated: readonly number[]) => (undated.length ? `${andList(undated.map((n) => `#${n}`))} ${undated.length === 1 ? "has" : "have"} no dates` : undefined);
