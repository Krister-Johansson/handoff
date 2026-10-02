import type { PlanStatus } from "@handoff/github";
import type { BacklogIssue } from "@/server/backlog";
import type { PlanColumn, PlanEpic, PlanTask, PlanView } from "@/server/plan";

/** The Plan page's statuses in board order; the client keeps its own copy so the GitHub package stays on the server. */
export const PLAN_STATUSES: readonly PlanStatus[] = ["Shaping", "Ready", "Running", "In review", "Done"];

/** Which tasks the Run filter keeps: any, those with an active run, those whose run waits on a person, those no run linked. */
export const RUN_FILTERS = ["any", "active", "needs-you", "none"] as const;
export type RunFilter = (typeof RUN_FILTERS)[number];

export type PlanFilters = {
  /** One epic by number, the unplanned issues, or everything. */
  epic: number | "unplanned" | undefined;
  /** The statuses to keep; empty keeps all. */
  status: PlanStatus[];
  run: RunFilter;
};

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

/** The Plan page's filters from ?epic=, ?status= (comma separated) and ?run=; anything unknown means no filter. */
export function parsePlanFilters(params: Params): PlanFilters {
  const epic = one(params.epic);
  const run = one(params.run);
  const status = one(params.status)?.split(",") ?? [];
  return {
    epic: epic === "unplanned" ? "unplanned" : epic && /^\d+$/.test(epic) ? Number(epic) : undefined,
    status: PLAN_STATUSES.filter((s) => status.includes(s)),
    run: (RUN_FILTERS as readonly string[]).includes(run ?? "") ? (run as RunFilter) : "any",
  };
}

/** Whether any filter narrows the plan. */
export const isFiltered = (f: PlanFilters) => f.epic !== undefined || f.status.length > 0 || f.run !== "any";

const ACTIVE = new Set(["queued", "running", "waiting"]);
const columnOf = (task: PlanTask): PlanColumn => (task.state === "closed" ? "Done" : (task.status ?? "Other"));

export type NarrowedPlan = Pick<PlanView, "epics" | "unparented" | "board" | "unplanned"> & {
  /** Per epic, how many of its tasks the status and run filters hide. */
  hidden: Record<number, number>;
};

/**
 * The plan narrowed by the filters, for the tree and the board alike. Progress keeps counting every
 * task of an epic or a story; with a status or run filter, stories and epics left without a matching
 * task drop out, and each epic says how many of its tasks are hidden.
 */
export function filterPlan(view: PlanView, filters: PlanFilters, needsYou: readonly string[]): NarrowedPlan {
  const keepRun = (run: PlanTask["run"] | BacklogIssue["run"]): boolean => {
    if (filters.run === "active") return run !== null && ACTIVE.has(run.status);
    if (filters.run === "needs-you") return run !== null && needsYou.includes(run.id);
    if (filters.run === "none") return run === null;
    return true;
  };
  const keep = (task: PlanTask) => (filters.status.length === 0 || filters.status.some((s) => s === columnOf(task))) && keepRun(task.run);
  const narrowing = filters.status.length > 0 || filters.run !== "any";
  const hidden: Record<number, number> = {};
  const inEpic = (epic: PlanEpic) => filters.epic === undefined || filters.epic === epic.number;

  const epics = view.epics.filter(inEpic).flatMap((epic): PlanEpic[] => {
    const stories = epic.stories.map((s) => ({ ...s, tasks: s.tasks.filter(keep) })).filter((s) => !narrowing || s.tasks.length > 0);
    const tasks = epic.tasks.filter(keep);
    const all = epic.stories.reduce((n, s) => n + s.tasks.length, epic.tasks.length);
    const shown = stories.reduce((n, s) => n + s.tasks.length, tasks.length);
    if (narrowing && shown === 0) return [];
    if (all > shown) hidden[epic.number] = all - shown;
    return [{ ...epic, stories, tasks }];
  });
  const outside = filters.epic === undefined;
  const unparented = outside ? view.unparented.filter(keep) : [];
  // The board holds every task of the plan, so it narrows by the filters themselves rather than by what the tree shows.
  const epic = typeof filters.epic === "number" ? view.epics.find((e) => e.number === filters.epic) : undefined;
  const ofEpic = epic && new Set([...epic.stories.flatMap((s) => s.tasks), ...epic.tasks].map((t) => t.number));
  const onBoard = (t: PlanTask) => filters.epic !== "unplanned" && (ofEpic === undefined ? outside : ofEpic.has(t.number)) && keep(t);
  const board = Object.fromEntries(Object.entries(view.board).map(([column, tasks]) => [column, tasks.filter(onBoard)])) as Record<PlanColumn, PlanTask[]>;
  const unplanned =
    (outside || filters.epic === "unplanned") && filters.status.length === 0 ? view.unplanned.filter((i) => keepRun(i.run && i.run.status !== "cancelled" ? i.run : null)) : [];
  return { epics, unparented, board, unplanned, hidden };
}
