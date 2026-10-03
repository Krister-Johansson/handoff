import type { PlanItem, PlanSize } from "@handoff/github";
import { SIZES } from "./size-text";

/** What Optimize reads of a task; a PlanItem has it. */
export type OptimizeTask = Pick<PlanItem, "number" | "status" | "blockedBy" | "size" | "priority">;

export type OptimizeInput = {
  /** The Flow's queue: Ready tasks in the scheduler's order, then Shaping tasks. */
  queue: readonly number[];
  /** The plan's tasks; a task in the queue without an entry counts as an M without blockers. */
  tasks: readonly OptimizeTask[];
  /** Minutes per size, from the forecasts, as layoutFlow takes them. */
  minutes: Record<PlanSize, number>;
  /** The Priority field's options, the highest first; undefined when the Project has none. */
  priorityOptions?: string[] | undefined;
  pins: ReadonlySet<number>;
  /** The tasks Optimize may move: those inside the ticked epics, stories and tasks; undefined for the whole queue. */
  scope?: ReadonlySet<number> | undefined;
};

export type Optimized = {
  queue: number[];
  /** Each task whose place changed, in its new order; places count from 1, as Next does. */
  moved: { issue: number; from: number; to: number }[];
  /** The pinned tasks in the scope, which kept their places. */
  kept: number[];
};

/** A task without a size counts as M. */
const DEFAULT_SIZE: PlanSize = "M";

/**
 * The queue arranged for the earliest finish (docs/plans/flow.md, Decision 11). Pinned tasks and tasks
 * outside the scope keep their places. The other places, from the front, each take the highest-ranked
 * task whose blockers in the queue all sit earlier, or the highest-ranked task when none does. Rank,
 * highest first: the longest chain of work the task starts, the work it unblocks, Priority, the larger
 * size, then its current place. Chains and work count tasks in the queue, in forecast minutes.
 */
export function optimize(input: OptimizeInput): Optimized {
  const byNumber = new Map(input.tasks.map((t) => [t.number, t]));
  const place = new Map(input.queue.map((n, index) => [n, index]));
  const blockersOf = (n: number) => (byNumber.get(n)?.blockedBy ?? []).filter((b) => place.has(b));
  const lengthOf = (n: number) => input.minutes[byNumber.get(n)?.size ?? DEFAULT_SIZE];
  const blocks = new Map<number, number[]>();
  for (const n of input.queue) for (const b of blockersOf(n)) blocks.set(b, [...(blocks.get(b) ?? []), n]);

  const chains = new Map<number, number>();
  const chainOf = (n: number): number => {
    if (!chains.has(n)) {
      // A cycle of blockers counts nothing twice.
      chains.set(n, 0);
      chains.set(n, lengthOf(n) + Math.max(0, ...(blocks.get(n) ?? []).map(chainOf)));
    }
    return chains.get(n)!;
  };
  /** Every task the task blocks, directly or through others. */
  const waiting = (n: number, found = new Set<number>()): Set<number> => {
    for (const d of blocks.get(n) ?? []) if (!found.has(d)) waiting(d, found.add(d));
    return found;
  };
  const options = input.priorityOptions ?? [];
  const rankOf = (n: number) => {
    const priority = options.indexOf(byNumber.get(n)?.priority ?? "");
    return [
      -chainOf(n),
      -[...waiting(n)].reduce((sum, d) => sum + lengthOf(d), 0),
      // A task without a priority ranks after every option.
      priority === -1 ? options.length : priority,
      -SIZES.indexOf(byNumber.get(n)?.size ?? DEFAULT_SIZE),
      place.get(n)!,
    ];
  };

  const inScope = (n: number) => input.scope === undefined || input.scope.has(n);
  const fixed = (n: number) => input.pins.has(n) || !inScope(n);
  const ranks = new Map(input.queue.filter((n) => !fixed(n)).map((n) => [n, rankOf(n)]));
  const ranked = [...ranks.keys()].sort((a, b) => {
    const [x, y] = [ranks.get(a)!, ranks.get(b)!];
    return x.map((v, index) => v - y[index]!).find((d) => d !== 0) ?? 0;
  });

  // A Ready task's place goes to a Ready task and a Shaping task's to a Shaping task: the scheduler
  // starts no Shaping task, so the Flow keeps them after every Ready task.
  const shaping = (n: number) => byNumber.get(n)?.status === "Shaping";
  const queue: number[] = [];
  for (const n of input.queue) {
    if (fixed(n)) {
      queue.push(n);
      continue;
    }
    const earlier = new Set(queue);
    const tier = ranked.filter((t) => shaping(t) === shaping(n));
    // A task whose blocker sits later goes only when no task may go; it then waits for its blocker.
    const pick = tier.find((t) => blockersOf(t).every((b) => earlier.has(b))) ?? tier[0]!;
    ranked.splice(ranked.indexOf(pick), 1);
    queue.push(pick);
  }

  const moved = queue.flatMap((issue, index) => (place.get(issue) === index ? [] : [{ issue, from: place.get(issue)! + 1, to: index + 1 }]));
  return { queue, moved, kept: input.queue.filter((n) => input.pins.has(n) && inScope(n)) };
}
