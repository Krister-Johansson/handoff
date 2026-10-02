import type { PlanColumn, PlanTask } from "@/server/plan";

/** The board column a task sits in: a closed task is done whatever its Status says. */
export const taskColumn = (task: PlanTask): PlanColumn => (task.state === "closed" ? "Done" : (task.status ?? "Other"));

/** The task's pull request: the one its run opened, else the latest GitHub links to the issue. */
export const prNumberOf = (task: PlanTask): number | undefined => task.run?.prNumber ?? task.prNumbers.at(-1);

/** The kind labels; the client keeps its own copy so the GitHub package stays on the server. */
const KIND_LABELS = new Set(["epic", "story", "task"]);
export const hasKindLabel = (labels: readonly string[]) => labels.some((l) => KIND_LABELS.has(l.toLowerCase()));

/** Run statuses in which a run still owns its task. */
const ACTIVE = new Set(["queued", "running", "waiting"]);
export const hasActiveRun = (task: PlanTask) => task.run !== null && ACTIVE.has(task.run.status);

export type Move = "ready" | "shaping";

/**
 * The moves handoff owns for a task as its status allows: to Ready from Shaping, back to Shaping from
 * Ready, and both for a task that was reopened in Done. A task its run still owns has none.
 */
export function movesOf(task: PlanTask): Move[] {
  if (hasActiveRun(task)) return [];
  const column = taskColumn(task);
  if (column === "Shaping") return ["ready"];
  if (column === "Ready") return ["shaping"];
  if (column === "Done" && task.state === "open") return ["shaping", "ready"];
  return [];
}

/** Each column's colours: Shaping grey, Ready blue, Running amber, In review purple, Done green. */
export const COLUMN_TONE: Record<PlanColumn, { pill: string; dot: string }> = {
  Shaping: { pill: "border-transparent bg-secondary text-muted-foreground", dot: "bg-muted-foreground/70" },
  Ready: { pill: "border-transparent bg-active-bg text-active", dot: "bg-active-dot" },
  Running: { pill: "border-transparent bg-attention-bg text-attention", dot: "bg-attention-dot" },
  "In review": { pill: "border-transparent bg-repaired-bg text-repaired", dot: "bg-repaired-dot" },
  Done: { pill: "border-transparent bg-success-bg text-success", dot: "bg-success-dot" },
  Other: { pill: "border-border text-muted-foreground", dot: "bg-border" },
};

/** Each status's bar on the timeline: its colour at 70 percent with a border in the full colour. */
export const BAR_TONE: Record<PlanColumn, string> = {
  Shaping: "border-muted-foreground/60 bg-muted-foreground/35",
  Ready: "border-active-dot bg-active-dot/70",
  Running: "border-attention-dot bg-attention-dot/70",
  "In review": "border-repaired-dot bg-repaired-dot/70",
  Done: "border-success-dot bg-success-dot/70",
  Other: "border-border bg-muted",
};
