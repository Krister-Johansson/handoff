import { and, eq, inArray, not, planPins, projects, projectSchedulers, sql, type Db, type PinReason } from "@handoff/db";
import { orderMoves, type ProjectsPort } from "@handoff/github";
import { layoutFlow } from "../lib/plan/flow";
import { loadFlow } from "./flow";
import { projectsAccessProblem } from "./plan";

export type OrderDeps = { db: Db; projects: ProjectsPort | undefined };

/** A new order of a Flow project's queue, with the pin changes that go with it. */
export type OrderWrite = {
  /** The queue as the page showed it: Ready tasks in order, then Shaping tasks. */
  shown: number[];
  /** The same tasks in their new order. */
  queue: number[];
  /** Tasks to pin at their new place; each must be in the queue. */
  pin?: number[] | undefined;
  unpin?: number[] | undefined;
  /** "person" from the dashboard, or the actor of set_order. */
  actor: string;
  /** Why the pins in `pin` are set: a drop unless said otherwise. */
  reason?: PinReason | undefined;
};

const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/**
 * Writes a new order of a Flow project's queue to Project order (docs/plans/flow.md, Decision 9), then the pin
 * changes. It reads the Project once and refuses when the queue there is not the one the page showed. The
 * queue's tasks, in their new order, fill the places its tasks held, so epics, stories, closed items and
 * running tasks keep theirs; the longest run of items already in order stays and every other item moves after
 * the item before it. Pins are written only after GitHub takes the order, so a refused write changes no pin.
 * The same write's pins drop a pin on a task that is closed or no longer in the plan.
 */
export async function writeOrder(deps: OrderDeps, projectId: string, write: OrderWrite): Promise<{ moved: number }> {
  const { db } = deps;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("The project no longer exists.");
  if (project.planMode !== "flow") throw new Error(`${project.name} plans in Timeline mode: order work with dates through arrange_plan and schedule.`);
  const [scheduler] = await db.select({ order: projectSchedulers.order }).from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId));
  if (scheduler?.order === "priority") {
    throw new Error("The scheduler starts tasks by Priority, so the order of the tasks does not decide what starts next. Switch the scheduler to Project order to plan by order.");
  }
  const shown = new Set(write.shown);
  if (shown.size !== write.shown.length || !sameList([...write.queue].sort((a, b) => a - b), [...write.shown].sort((a, b) => a - b))) {
    throw new Error("The new order must hold the same tasks as the order shown.");
  }
  const pin = write.pin ?? [];
  const outside = pin.find((issue) => !shown.has(issue));
  if (outside !== undefined) throw new Error(`#${outside} is not in the order, so it cannot be pinned.`);

  const plan = deps.projects;
  const problem = await projectsAccessProblem(plan);
  if (problem || !plan) throw new Error(problem);
  if (project.planProjectNumber === null) throw new Error("This project has no plan on GitHub yet.");
  const repo = { owner: project.repoOwner, name: project.repoName };
  const items = await plan.listItems(repo.owner, project.planProjectNumber, repo);
  // The queue on GitHub now, by the same rules the page laid it out with.
  const current = layoutFlow(await loadFlow(db, projectId, { items, priorityOptions: undefined })).queue;
  if (!sameList(current, write.shown)) throw new Error("The order changed on GitHub since the page loaded. The Flow now shows the new order.");

  const inOrder = [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const missing = inOrder.find((item) => item.itemId === undefined);
  if (missing) throw new Error(`#${missing.number} has no item id in GitHub Project #${project.planProjectNumber}, so its place cannot be written.`);
  const next = [...write.queue];
  const full = inOrder.map((item) => (shown.has(item.number) ? next.shift()! : item.number));
  const idOf = new Map(inOrder.map((item) => [item.number, item.itemId!]));
  const moves = orderMoves(
    inOrder.map((item) => item.itemId!),
    full.map((issue) => idOf.get(issue)!),
  );
  if (moves.length > 0) await plan.moveItems(repo.owner, project.planProjectNumber, moves);

  const openTasks = items.filter((item) => item.kind === "task" && item.state === "open").map((item) => item.number);
  await db.transaction(async (tx) => {
    await tx.delete(planPins).where(and(eq(planPins.projectId, projectId), openTasks.length > 0 ? not(inArray(planPins.issue, openTasks)) : undefined));
    if (write.unpin?.length) await tx.delete(planPins).where(and(eq(planPins.projectId, projectId), inArray(planPins.issue, write.unpin)));
    if (pin.length > 0) {
      await tx
        .insert(planPins)
        .values(pin.map((issue) => ({ projectId, issue, pinnedBy: write.actor, reason: write.reason ?? "drop" })))
        .onConflictDoUpdate({
          target: [planPins.projectId, planPins.issue],
          set: { pinnedBy: sql`excluded.pinned_by`, reason: sql`excluded.reason`, createdAt: sql`now()` },
        });
    }
  });
  return { moved: moves.length };
}

/** Removes a task's pin, from the pin on its card or the Pinned tag in its row. Nothing is written to GitHub. */
export async function unpin(db: Db, projectId: string, issue: number) {
  await db.delete(planPins).where(and(eq(planPins.projectId, projectId), eq(planPins.issue, issue)));
}
