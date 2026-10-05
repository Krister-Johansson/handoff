import type { Milestone } from "@handoff/github";
import type { MilestoneFlow, MilestoneTimeline } from "./milestones";
import { shortDay } from "./timeline-scale";

/** "Due Oct 3", or "No due date". */
export const dueText = (m: Pick<Milestone, "dueOn">) => (m.dueOn ? `Due ${shortDay(m.dueOn)}` : "No due date");

const daysText = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** How the Timeline's end stands against the due date: late, early, or on it. */
export type EndTone = "late" | "early" | "neutral";

/**
 * When the Timeline ends a milestone, from the latest Target of its tasks: "Ends Oct 4, 1 day late", "Ends Oct 13,
 * 3 days early", "Ends Oct 3, on the due date", or "Ends Oct 9" without a due date. Undefined with no dated task.
 */
export function endsText(timeline: MilestoneTimeline): { text: string; tone: EndTone } | undefined {
  if (!timeline.ends) return undefined;
  const ends = `Ends ${shortDay(timeline.ends)}`;
  const days = timeline.daysPastDue;
  if (days === undefined) return { text: ends, tone: "neutral" };
  if (days > 0) return { text: `${ends}, ${daysText(days)} late`, tone: "late" };
  if (days < 0) return { text: `${ends}, ${daysText(-days)} early`, tone: "early" };
  return { text: `${ends}, on the due date`, tone: "early" };
}

/** Issues named in a list: "#1", "#1 and #2", "#1, #2 and #3". */
export const issueList = (issues: readonly number[]) => {
  const named = issues.map((n) => `#${n}`);
  return named.length <= 1 ? (named[0] ?? "") : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
};

/** The most undated tasks a card names one by one; more are counted, and the title names them all. */
const NAMED = 3;

/** The open tasks without dates, which the end does not count: "#152 has no dates", or "4 tasks have no dates" with every one in `all`. */
export function undatedText(undated: readonly number[]): { text: string; all: string } | undefined {
  if (undated.length === 0) return undefined;
  const all = `${issueList(undated)} ${undated.length === 1 ? "has" : "have"} no dates`;
  return { text: undated.length <= NAMED ? all : `${undated.length} tasks have no dates`, all };
}

/** Where the Flow's order ends a milestone, which is a place and never a day: "Ends after Next 6". */
export const flowEndText = (flow: MilestoneFlow) => (flow.last ? `Ends after Next ${flow.last.place}` : undefined);

/** The line after a milestone's last card in the order: "0.9 ends here, after Next 6". */
export const flowLineText = (title: string, flow: MilestoneFlow) => (flow.last ? `${title} ends here, after Next ${flow.last.place}` : undefined);

/** "1 skipped", the milestone's tasks the scheduler passes over. */
export const skippedText = (flow: MilestoneFlow) => (flow.skipped.length ? `${flow.skipped.length} skipped` : undefined);
