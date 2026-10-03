import type { PlanItem } from "@handoff/github";
import type { PlanEpic, PlanTask } from "@/server/plan";

/**
 * The tree the Flow's tick boxes work on: each epic's stories and own tasks, each story's tasks, and the
 * unparented tasks at the top. Its items are the rows the Flow shows.
 */
export type SelectionTree = {
  parent: ReadonlyMap<number, number>;
  children: ReadonlyMap<number, readonly number[]>;
  /** Every task, for the scope. */
  tasks: ReadonlySet<number>;
  /** Each item with the kind of row it is in the tree. */
  items: ReadonlyMap<number, { item: PlanItem; kind: "epic" | "story" | "task" }>;
};

export function selectionTree(epics: readonly PlanEpic[], unparented: readonly PlanTask[]): SelectionTree {
  const parent = new Map<number, number>();
  const children = new Map<number, number[]>();
  const tasks = new Set<number>();
  const items = new Map<number, { item: PlanItem; kind: "epic" | "story" | "task" }>();
  const add = (item: PlanItem, kind: "epic" | "story" | "task", under?: number) => {
    items.set(item.number, { item, kind });
    if (under === undefined) return;
    parent.set(item.number, under);
    children.set(under, [...(children.get(under) ?? []), item.number]);
  };
  for (const epic of epics) {
    add(epic, "epic");
    for (const story of epic.stories) {
      add(story, "story", epic.number);
      for (const task of story.tasks) {
        add(task, "task", story.number);
        tasks.add(task.number);
      }
    }
    for (const task of epic.tasks) {
      add(task, "task", epic.number);
      tasks.add(task.number);
    }
  }
  for (const task of unparented) {
    add(task, "task");
    tasks.add(task.number);
  }
  return { parent, children, tasks, items };
}

/** The item and the items above it, the item first. */
function lineOf(tree: SelectionTree, n: number): number[] {
  const line = [n];
  for (let up = tree.parent.get(n); up !== undefined; up = tree.parent.get(up)) line.push(up);
  return line;
}

/** Every item under the item, not counting it. */
function under(tree: SelectionTree, n: number): number[] {
  return (tree.children.get(n) ?? []).flatMap((c) => [c, ...under(tree, c)]);
}

/** Ticked: the person ticked the item or an item above it. */
export const isTicked = (picks: ReadonlySet<number>, tree: SelectionTree, n: number) => lineOf(tree, n).some((i) => picks.has(i));

/** Half ticked: not ticked, but the person ticked an item under it. */
export const isMixed = (picks: ReadonlySet<number>, tree: SelectionTree, n: number) => !isTicked(picks, tree, n) && under(tree, n).some((i) => picks.has(i));

/**
 * The picks after a click on an item's tick box. Ticking an item covers what is under it. Unticking an item
 * ticked through an item above it ticks that item's other children instead, down to the item, so everything
 * else stays ticked.
 */
export function togglePick(picks: ReadonlySet<number>, tree: SelectionTree, n: number): Set<number> {
  const next = new Set(picks);
  if (!isTicked(picks, tree, n)) {
    for (const i of under(tree, n)) next.delete(i);
    next.add(n);
    return next;
  }
  const line = lineOf(tree, n);
  const from = line.findIndex((i) => picks.has(i));
  // From the ticked item down to the clicked one, each step ticks the siblings of the next item down.
  for (let i = from; i > 0; i--) {
    next.delete(line[i]!);
    for (const c of tree.children.get(line[i]!) ?? []) if (c !== line[i - 1]) next.add(c);
  }
  next.delete(n);
  return next;
}

/** The tasks inside the ticked items, or undefined when nothing is ticked and Optimize works on the whole queue. */
export function scopeOf(picks: ReadonlySet<number>, tree: SelectionTree): Set<number> | undefined {
  if (picks.size === 0) return undefined;
  return new Set([...picks].flatMap((n) => [n, ...under(tree, n)]).filter((n) => tree.tasks.has(n)));
}

/** What the selection is called in Optimize's sentences: "epic #12 Project management", "the 2 selected items", or "the plan". */
export function scopeName(picks: ReadonlySet<number>, tree: SelectionTree): string {
  if (picks.size === 0) return "the plan";
  if (picks.size > 1) return `the ${picks.size} selected items`;
  const [n] = picks;
  const found = tree.items.get(n!);
  return found ? `${found.kind} #${n} ${found.item.title}` : `#${n}`;
}
