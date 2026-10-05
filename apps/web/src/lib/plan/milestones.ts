import type { Milestone, MilestoneRef, PlanItem, PlanStatus, RepoRef } from "@handoff/github";
import { PLAN_STATUSES } from "./filters";
import type { Flow } from "./flow";
import type { Timeline } from "./schedule";

/** The story or epic an item took its milestone from. */
export type MilestoneFrom = { kind: "story" | "epic"; issue: number };

/** An item's milestone: its own, or, without `inherited`, the one its story or epic has. */
export type ItemMilestone = MilestoneRef & { inherited?: MilestoneFrom | undefined };

const isTask = (item: Pick<PlanItem, "kind">) => item.kind !== "story" && item.kind !== "epic";

/**
 * Each item's milestone. An item with one of its own keeps it. A task without one takes its story's, else its
 * epic's, and a story its epic's; an epic has only its own. The walk up the parents stays inside the plan.
 * Items in no milestone are left out.
 */
export function itemMilestones(items: readonly PlanItem[]): Map<number, ItemMilestone> {
  const byNumber = new Map(items.map((i) => [i.number, i]));
  const of = new Map<number, ItemMilestone>();
  for (const item of items) {
    if (item.milestone) {
      of.set(item.number, { number: item.milestone.number, title: item.milestone.title });
      continue;
    }
    if (item.kind === "epic") continue;
    const holds = (kind: PlanItem["kind"]) => kind === "epic" || (kind === "story" && item.kind !== "story");
    const seen = new Set<number>();
    for (let p = item.parent; p !== undefined && !seen.has(p); p = byNumber.get(p)?.parent) {
      seen.add(p);
      const parent = byNumber.get(p);
      if (!parent) break;
      if (!holds(parent.kind) || !parent.milestone) continue;
      of.set(item.number, { number: parent.milestone.number, title: parent.milestone.title, inherited: { kind: parent.kind as "story" | "epic", issue: parent.number } });
      break;
    }
  }
  return of;
}

/** A task's board column: a closed task is done whatever its Status says, and a Status handoff does not know is Other. */
export type TaskColumn = PlanStatus | "Other";

/** Tasks done out of the total, and how many are in each column. */
export type MilestoneTasks = { done: number; total: number; byStatus: Record<TaskColumn, number> };

/**
 * A milestone judged in Timeline mode. `ends` is the latest Target among its tasks, as the timeline computes it;
 * `daysPastDue` is the days from the due date to that Target (positive late, negative early, 0 on the day), and
 * undefined without a due date or a dated task. `undated` names the open tasks without dates, which are not counted.
 */
export type MilestoneTimeline = { ends: string | undefined; daysPastDue: number | undefined; undated: number[] };

/**
 * A milestone in Flow mode, which has no dates: `last` is its last task in the flow's order with its place there,
 * from 1 (Ready tasks fill the first places, so a Ready task's place is its Next number). `skipped` names its tasks
 * the scheduler passes over, which are not in the order.
 */
export type MilestoneFlow = { last: { issue: number; place: number } | undefined; skipped: number[] };

/** A milestone's tasks, and the judgement of the plan mode given: a Timeline's end, or a Flow's place. */
export type MilestoneProgress = MilestoneTasks & { timeline?: MilestoneTimeline; flow?: MilestoneFlow };

export type PlanMilestone = Milestone & { progress: MilestoneProgress };

const COLUMNS: readonly TaskColumn[] = [...PLAN_STATUSES, "Other"];

const columnOf = (task: PlanItem): TaskColumn => (task.state === "closed" ? "Done" : PLAN_STATUSES.includes(task.status as PlanStatus) ? (task.status as PlanStatus) : "Other");

function countTasks(tasks: readonly PlanItem[]): MilestoneTasks {
  const byStatus = Object.fromEntries(COLUMNS.map((c) => [c, 0])) as Record<TaskColumn, number>;
  for (const task of tasks) byStatus[columnOf(task)]++;
  return { done: byStatus.Done, total: tasks.length, byStatus };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

function judgeTimeline(milestone: Milestone, tasks: readonly PlanItem[], timeline: Timeline): MilestoneTimeline {
  const spans = new Map(timeline.items.map((i) => [i.number, i.planned]));
  const ends = tasks.flatMap((t) => spans.get(t.number)?.end ?? []).sort();
  const last = ends.at(-1);
  const undated = tasks.filter((t) => columnOf(t) !== "Done" && !spans.get(t.number)).map((t) => t.number);
  return { ends: last, daysPastDue: last && milestone.dueOn ? daysBetween(milestone.dueOn, last) : undefined, undated };
}

function judgeFlow(tasks: readonly PlanItem[], flow: Flow): MilestoneFlow {
  const placeOf = new Map(flow.queue.map((n, index) => [n, index + 1]));
  const skipping = new Set(flow.rows.filter((r) => r.tags.some((t) => t.startsWith("Skipped: "))).map((r) => r.issue));
  const placed = tasks.flatMap((t) => (placeOf.has(t.number) ? [{ issue: t.number, place: placeOf.get(t.number)! }] : []));
  const last = placed.sort((a, b) => a.place - b.place).at(-1);
  return { last, skipped: tasks.filter((t) => skipping.has(t.number)).map((t) => t.number) };
}

/** What a milestone is judged against: the Timeline in Timeline mode, the laid-out Flow in Flow mode, or neither. */
export type MilestoneJudge = { timeline?: Timeline | undefined; flow?: Flow | undefined };

/**
 * Each milestone's progress over the plan's tasks, own or inherited (epics and stories are not counted), with the
 * judgement of the mode given, and the tasks in no milestone. A milestone keeps the place `milestones` gives it.
 */
export function milestoneProgress(milestones: readonly Milestone[], items: readonly PlanItem[], judge: MilestoneJudge): { milestones: PlanMilestone[]; none: MilestoneTasks } {
  const of = itemMilestones(items);
  const tasks = items.filter(isTask);
  const inMilestone = (number: number | undefined) => tasks.filter((t) => of.get(t.number)?.number === number);
  return {
    milestones: milestones.map((m) => {
      const mine = inMilestone(m.number);
      const progress: MilestoneProgress = {
        ...countTasks(mine),
        ...(judge.timeline ? { timeline: judgeTimeline(m, mine, judge.timeline) } : {}),
        ...(judge.flow ? { flow: judgeFlow(mine, judge.flow) } : {}),
      };
      return { ...m, progress };
    }),
    none: countTasks(inMilestone(undefined)),
  };
}

const named = (m: Milestone) => `${m.title} (#${m.number}${m.dueOn ? `, due ${m.dueOn}` : ""})`;

/**
 * The open milestone a tool names by number or by title (titles match without regard to case or surrounding
 * spaces). Refuses a closed milestone and one the repository lacks with a sentence that lists the open ones.
 */
export function resolveMilestone(milestones: readonly Milestone[], ref: number | string, repo: RepoRef): MilestoneRef {
  const key = typeof ref === "string" ? ref.trim().toLowerCase() : ref;
  const found = milestones.find((m) => (typeof key === "number" ? m.number === key : m.title.trim().toLowerCase() === key));
  const open = milestones.filter((m) => m.state === "open");
  const listed = open.map(named).join(", ");
  const repoName = `${repo.owner}/${repo.name}`;
  if (!found) {
    const asked = typeof ref === "number" ? `#${ref}` : `"${ref.trim()}"`;
    const choices = open.length ? `Its open milestones: ${listed}.` : "It has no open milestones; create one on GitHub first.";
    throw new Error(`${repoName} has no milestone ${asked}. ${choices}`);
  }
  if (found.state === "closed") {
    const choices = open.length ? `, or pick an open milestone: ${listed}.` : ". It has no open milestones.";
    throw new Error(`Milestone ${found.title} (#${found.number}) of ${repoName} is closed. Reopen it on GitHub${choices}`);
  }
  return { number: found.number, title: found.title };
}
