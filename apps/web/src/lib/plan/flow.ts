import type { StepProgress } from "@handoff/core";
import { orderTasks, skipReason, type IssueRun } from "@handoff/engine/candidates";
import type { PlanItem, PlanSize } from "@handoff/github";

/** An active run of the project: queued, running or waiting. */
export type FlowRun = {
  /** The issue the run works on; its card sits on that issue's row. */
  issue: number;
  runId: string;
  /** Older runs take lower lanes. */
  createdAt: Date;
  /** Graph steps done of the graph's steps, from stepProgress. */
  progress: StepProgress;
  /** What the run waits for, such as "Waits on you: review"; undefined while it works. */
  waitsOn?: string | undefined;
};

export type FlowInput = {
  /** The plan's items as listItems returns them; only tasks get cards. */
  tasks: PlanItem[];
  runs: FlowRun[];
  /** The runs the scheduler may hold at once: its max_runs, or 1 without a scheduler. */
  lanes: number;
  order: "project" | "priority";
  priorityOptions?: string[] | undefined;
  skipLabel?: string | null | undefined;
  /** Cancelled runs a person let the scheduler take again. */
  released?: ReadonlySet<string> | undefined;
  /** Each issue's active run, else its latest, as issueRuns gives it. */
  latest: ReadonlyMap<number, IssueRun>;
  /** Why the scheduler is held, one sentence per hold; empty when it is not. */
  held: string[];
  /** Tasks a person or set_order pinned to their place. */
  pins: ReadonlySet<number>;
  /** Minutes per size, from the forecasts; they only decide which lane frees first. */
  minutes: Record<PlanSize, number>;
};

export type FlowCard = {
  issue: number;
  kind: "running" | "next" | "shaping";
  /** The lane, 1 for the first. */
  lane: number;
  /** Minutes from now; a running card starts before now. */
  start: number;
  end: number;
  size: PlanSize;
  /** False when the task has no size and counts as M. */
  sized: boolean;
  pinned: boolean;
  /** The task's place in the queue, 1 for the first; undefined for running and Shaping cards. */
  next?: number | undefined;
  progress?: StepProgress | undefined;
  waitsOn?: string | undefined;
  /** The blocker whose end this card waited for in an idle lane. */
  after?: number | undefined;
};

export type FlowRow = { issue: number; tags: string[] };

export type Flow = {
  /** Task numbers in the order the scheduler would start them, Ready then Shaping. */
  queue: number[];
  /** Every card, in the order the simulation placed them. */
  cards: FlowCard[];
  /** The cards of each lane, lane 1 first. */
  lanes: FlowCard[][];
  /** The tags on each task's row, such as "Next 2" or "After #55", in the order of `tasks`. */
  rows: FlowRow[];
  /** From a blocker's card end to the start of the card it blocks. */
  arrows: { from: number; to: number }[];
  /** Why the scheduler is held; the cards sit as if the hold cleared now. */
  held: string[];
  /** The latest card end, in minutes from now. */
  end: number;
};

/** A task without a size counts as M. */
const DEFAULT_SIZE: PlanSize = "M";

/**
 * Where each task would run if the scheduler worked from now (docs/plans/flow.md, Decision 5). Active
 * runs keep their lanes, oldest first. Each lane that frees takes the first task in the scheduler's
 * order whose blockers have ended, passing over a blocked one as the scheduler does, and nothing
 * starts while as many runs are active as there are lanes. Shaping tasks follow every Ready task.
 * The scheduler's one-plan-at-a-time rule is left out: planning is short next to a run.
 */
export function layoutFlow(input: FlowInput): Flow {
  const byNumber = new Map(input.tasks.map((t) => [t.number, t]));
  const sizeOf = (issue: number) => byNumber.get(issue)?.size;
  const lengthOf = (issue: number) => input.minutes[sizeOf(issue) ?? DEFAULT_SIZE];

  const active = [...input.runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lanes: FlowCard[][] = Array.from({ length: Math.max(input.lanes, active.length) }, () => []);
  const cards: FlowCard[] = [];
  active.forEach((r, index) => {
    const length = lengthOf(r.issue);
    const share = r.progress.total > 0 ? r.progress.done / r.progress.total : 0;
    const card: FlowCard = {
      issue: r.issue,
      kind: "running",
      lane: index + 1,
      start: share > 0 ? -length * share : 0,
      end: length * (1 - share),
      size: sizeOf(r.issue) ?? DEFAULT_SIZE,
      sized: sizeOf(r.issue) !== undefined,
      pinned: input.pins.has(r.issue),
      progress: r.progress,
      waitsOn: r.waitsOn,
    };
    cards.push(card);
    lanes[index]!.push(card);
  });

  const running = new Set(active.map((r) => r.issue));
  const options = { order: input.order, priorityOptions: input.priorityOptions, skipLabel: input.skipLabel, released: input.released };
  // The scheduler's order and skip rules; a blocked task keeps its place and waits in the queue.
  const skipped = new Map<number, string>();
  const ready = orderTasks(input.tasks, options).filter((t) => {
    if (t.kind !== "task" || t.status !== "Ready" || t.state !== "open" || running.has(t.number)) return false;
    const latest = input.latest.get(t.number);
    if (skipReason({ ...t, blockedBy: [] }, latest, options) === undefined) return true;
    if (input.skipLabel && t.labels.includes(input.skipLabel)) skipped.set(t.number, `Skipped: label ${input.skipLabel}`);
    else if (latest?.status === "cancelled") skipped.set(t.number, "Skipped: latest run cancelled");
    return false;
  });
  const nextOf = new Map(ready.map((t, index) => [t.number, index + 1]));
  // The scheduler starts no Shaping task, so they follow every Ready task, in Project order.
  const shaping = orderTasks(input.tasks, { order: "project" }).filter((t) => t.kind === "task" && t.status === "Shaping" && t.state === "open" && !running.has(t.number));
  const queue = [...ready, ...shaping].map((t) => t.number);
  const shapingSet = new Set(shaping.map((t) => t.number));

  // A Ready task gets a card when each open blocker is running or a Ready task with a card; a Shaping
  // task may also wait for Shaping tasks. A blocker outside that set never ends in the flow.
  const grow = (tier: PlanItem[], from: ReadonlySet<number>) => {
    const found = new Set(from);
    for (let grown = true; grown; ) {
      grown = false;
      for (const t of tier) {
        if (found.has(t.number) || !t.blockedBy.every((b) => found.has(b))) continue;
        found.add(t.number);
        grown = true;
      }
    }
    return found;
  };
  const readyPlaceable = grow(ready, running);
  const placeable = grow(shaping, readyPlaceable);
  /** The issue outside the flow that a task without a card waits for, through blockers in the queue. */
  const outside = (t: PlanItem, seen = new Set<number>()): number => {
    const allowed = shapingSet.has(t.number) ? placeable : readyPlaceable;
    const blocker = t.blockedBy.find((b) => !allowed.has(b))!;
    const inQueue = byNumber.get(blocker);
    const follows = nextOf.has(blocker) || (shapingSet.has(blocker) && shapingSet.has(t.number));
    if (!follows || !inQueue || seen.has(blocker)) return blocker;
    return outside(inQueue, seen.add(t.number));
  };

  // Each card's end; a blocker ends when its card does.
  const ends = new Map(cards.map((c) => [c.issue, c.end]));
  const pending = [...ready, ...shaping].filter((t) => placeable.has(t.number));
  // Regular lanes free when their card ends; a lane past `input.lanes` closes when its run ends.
  const freeAt = Array.from({ length: input.lanes }, (_, index) => lanes[index]?.at(-1)?.end ?? 0);
  let now = 0;
  while (pending.length > 0) {
    const readyLeft = () => pending.some((t) => nextOf.has(t.number));
    const startable = (t: PlanItem) => (nextOf.has(t.number) || !readyLeft()) && t.blockedBy.every((b) => (ends.get(b) ?? Infinity) <= now);
    const free = freeAt
      .map((at, lane) => ({ at, lane }))
      .filter(({ at }) => at <= now)
      .sort((a, b) => a.at - b.at || a.lane - b.lane);
    for (const { lane } of free) {
      // The scheduler starts nothing while the project runs as many runs as it may hold.
      if (cards.filter((c) => c.end > now).length >= input.lanes) break;
      const at = pending.findIndex(startable);
      if (at === -1) break;
      const [next] = pending.splice(at, 1);
      const issue = next!.number;
      // A lane that stood idle waited for the blocker that ended last.
      const blocker = next!.blockedBy.find((b) => ends.get(b) === now);
      const card: FlowCard = {
        issue,
        kind: nextOf.has(issue) ? "next" : "shaping",
        lane: lane + 1,
        start: now,
        end: now + lengthOf(issue),
        size: sizeOf(issue) ?? DEFAULT_SIZE,
        sized: sizeOf(issue) !== undefined,
        pinned: input.pins.has(issue),
        next: nextOf.get(issue),
        after: freeAt[lane]! < now ? blocker : undefined,
      };
      freeAt[lane] = card.end;
      ends.set(issue, card.end);
      cards.push(card);
      lanes[lane]!.push(card);
    }
    const later = cards.map((c) => c.end).filter((end) => end > now);
    if (later.length === 0) break;
    now = Math.min(...later);
  }

  const cardOf = new Map(cards.map((c) => [c.issue, c]));
  const arrows = cards.flatMap((c) => (byNumber.get(c.issue)?.blockedBy ?? []).filter((b) => cardOf.has(b)).map((from) => ({ from, to: c.issue })));
  const rows = input.tasks
    .filter((t) => t.kind === "task")
    .map((t) => {
      const card = cardOf.get(t.number);
      const skip = skipped.get(t.number);
      if (skip) return { issue: t.number, tags: [skip, "Not in the order"] };
      if (card?.kind === "running") return { issue: t.number, tags: card.waitsOn ? [card.waitsOn] : [] };
      if (t.state === "closed" || t.status === "Done") return { issue: t.number, tags: ["Done"] };
      const next = nextOf.get(t.number);
      const tags = [
        ...(shapingSet.has(t.number) ? ["Shaping"] : []),
        ...(next !== undefined ? [`Next ${next}`] : []),
        ...(next !== undefined && input.pins.has(t.number) ? ["Pinned"] : []),
        ...(card?.after !== undefined ? [`After #${card.after}`] : []),
        ...((next !== undefined || shapingSet.has(t.number)) && !placeable.has(t.number) ? [`Waits for #${outside(t)}, not in the order`] : []),
        ...(input.held.length > 0 && t.number === queue[0] ? ["Waits for the hold"] : []),
      ];
      return { issue: t.number, tags };
    });

  return { queue, cards, lanes, rows, arrows, held: input.held, end: Math.max(0, ...cards.map((c) => c.end)) };
}
