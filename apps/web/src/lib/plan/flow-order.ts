/**
 * Pure operations on the Flow's queue, the task numbers in the order the scheduler would start them
 * (docs/plans/flow.md, Decisions 8 and 10). Each returns a new queue with the same tasks. A drop is
 * moveTo, or one of the rule-break dialog's choices, then carryDependents when its checkbox is on, then
 * keepPins.
 */

/** Each task's open blockers, by issue number. */
export type Blockers = ReadonlyMap<number, readonly number[]>;

/** "Move to the next free slot": the task goes right after the last of its blockers in the queue. */
export function afterBlockers(queue: readonly number[], issue: number, blockers: Blockers): number[] {
  const last = Math.max(-1, ...(blockers.get(issue) ?? []).map((b) => queue.indexOf(b)));
  if (!queue.includes(issue) || last < queue.indexOf(issue)) return [...queue];
  const rest = queue.filter((n) => n !== issue);
  rest.splice(last, 0, issue);
  return rest;
}

/** The queue with the task taken out and put back at `index`, its 0-based place after the move. */
export function moveTo(queue: readonly number[], issue: number, index: number): number[] {
  if (!queue.includes(issue)) return [...queue];
  const rest = queue.filter((n) => n !== issue);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, issue);
  return rest;
}

/**
 * "Move #61 earlier too": the task is dropped at `index`, and each of its blockers that sits later in
 * the queue, with those blockers' own blockers that sit later, moves to just before it in blocker order.
 * Running and closed blockers are not in the queue and do not move.
 */
export function blockersFirst(queue: readonly number[], issue: number, index: number, blockers: Blockers): number[] {
  const dropped = moveTo(queue, issue, index);
  const at = dropped.indexOf(issue);
  const later = new Set<number>();
  const visit = (n: number) => {
    for (const b of blockers.get(n) ?? []) {
      if (later.has(b) || dropped.indexOf(b) <= at) continue;
      later.add(b);
      visit(b);
    }
  };
  visit(issue);
  const rest = dropped.filter((n) => !later.has(n));
  rest.splice(rest.indexOf(issue), 0, ...inBlockerOrder(dropped.filter((n) => later.has(n)), blockers));
  return rest;
}

/** The tasks with each one after its blockers among them, else in the order given. */
function inBlockerOrder(tasks: readonly number[], blockers: Blockers): number[] {
  const left = new Set(tasks);
  const ordered: number[] = [];
  while (left.size > 0) {
    // A cycle of blockers has no task to take first; the first one left then goes.
    const next = [...left].find((n) => (blockers.get(n) ?? []).every((b) => !left.has(b))) ?? left.values().next().value!;
    left.delete(next);
    ordered.push(next);
  }
  return ordered;
}

/** A task placed before open blockers that are also in the queue: its row says "Waits for #61". */
export type RuleBreak = { issue: number; waitsFor: number[] };

/** Every task that sits before one of its open blockers in the queue, in queue order, its blockers in queue order. */
export function ruleBreaks(queue: readonly number[], blockers: Blockers): RuleBreak[] {
  const place = new Map(queue.map((n, index) => [n, index]));
  return queue.flatMap((issue, index) => {
    const waitsFor = (blockers.get(issue) ?? []).filter((b) => (place.get(b) ?? -1) > index).sort((a, b) => place.get(a)! - place.get(b)!);
    return waitsFor.length > 0 ? [{ issue, waitsFor }] : [];
  });
}

/** Each task's open blockers, turned around: the tasks each one blocks. */
export type Blocks = ReadonlyMap<number, readonly number[]>;

/**
 * "Move the tasks that wait on #62 with it": every task the issue blocks, directly or through others,
 * that sits before it moves to right after it, in the order those tasks had. A pinned task never moves:
 * it keeps its place, and ruleBreaks gives it the warning.
 */
export function carryDependents(queue: readonly number[], issue: number, blocks: Blocks, pins: ReadonlySet<number>): number[] {
  const waiting = new Set<number>();
  const visit = (n: number) => {
    for (const d of blocks.get(n) ?? []) {
      if (waiting.has(d)) continue;
      waiting.add(d);
      visit(d);
    }
  };
  visit(issue);
  const at = queue.indexOf(issue);
  const carried = queue.filter((n, index) => index < at && waiting.has(n) && !pins.has(n));
  const moving = new Set(carried);
  const rest = queue.filter((n) => !moving.has(n));
  rest.splice(rest.indexOf(issue) + 1, 0, ...carried);
  return rest;
}

/**
 * set_order's order: the tasks of `order` that are in the queue, in that order, fill the places they hold now,
 * as an Optimize scope does; every other task keeps its place. A task named twice counts once.
 */
export function fillPlaces(queue: readonly number[], order: readonly number[]): number[] {
  const inQueue = new Set(queue);
  const next = [...new Set(order)].filter((n) => inQueue.has(n));
  const moving = new Set(next);
  return queue.map((n) => (moving.has(n) ? next.shift()! : n));
}

/** Each task whose place changed between two orders of the same tasks, in its new order; places count from 1, as Next does. */
export function placeMoves(before: readonly number[], after: readonly number[]): { issue: number; from: number; to: number }[] {
  const place = new Map(before.map((n, index) => [n, index + 1]));
  return after.flatMap((issue, index) => (place.get(issue) === index + 1 ? [] : [{ issue, from: place.get(issue)!, to: index + 1 }]));
}

/**
 * Each pinned task back at its place from before the operation, and the other tasks in the places
 * left, in their order after it. `before` and `after` hold the same tasks. Every order operation ends
 * with this; a task the operation itself pins, such as a dropped card, is left out of `pins`.
 */
export function keepPins(before: readonly number[], after: readonly number[], pins: ReadonlySet<number>): number[] {
  const present = new Set(after);
  const stay = new Set(before.filter((n) => pins.has(n) && present.has(n)));
  const places: (number | undefined)[] = after.map(() => undefined);
  before.forEach((n, index) => {
    if (stay.has(n)) places[index] = n;
  });
  const rest = after.filter((n) => !stay.has(n));
  return places.map((n) => n ?? rest.shift()!);
}
