import type { PlanItem } from "@handoff/github";

type RunStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";

/** The run that counts for an issue: its active run when it has one, else its latest run. */
export type IssueRun = { id: string; status: RunStatus };

export type CandidateOptions = {
  /** Project order, or the Priority field first with Project order breaking ties. */
  order: "project" | "priority";
  /** The Priority field's options, the highest first; undefined when the Project has no such field. */
  priorityOptions?: string[] | undefined;
  /** Tasks with this label are left to a person; null or undefined skips none. */
  skipLabel?: string | null | undefined;
};

export type Candidate = { number: number; title: string };
export type Skipped = { number: number; title: string; reason: string };

const ACTIVE: RunStatus[] = ["queued", "running", "waiting"];

/**
 * The tasks the scheduler may start, in the order it starts them, and the Ready tasks it passes over
 * with the reason. Only open tasks in Ready count; epics, stories, other columns and closed issues
 * are neither candidates nor skipped.
 */
export function candidates(items: PlanItem[], runs: ReadonlyMap<number, IssueRun>, opts: CandidateOptions): { candidates: Candidate[]; skipped: Skipped[] } {
  const result = { candidates: [] as Candidate[], skipped: [] as Skipped[] };
  const options = opts.order === "priority" ? (opts.priorityOptions ?? []) : [];
  // An item without a priority ranks after every option.
  const rank = (item: PlanItem) => {
    const at = item.priority === undefined ? -1 : options.indexOf(item.priority);
    return at === -1 ? options.length : at;
  };
  const ordered = items
    .map((item, index) => ({ item, rank: rank(item), position: item.position ?? index }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position);
  for (const { item } of ordered) {
    if (item.kind !== "task" || item.status !== "Ready" || item.state !== "open") continue;
    const reason = skipReason(item, runs.get(item.number), opts.skipLabel);
    if (reason) result.skipped.push({ number: item.number, title: item.title, reason });
    else result.candidates.push({ number: item.number, title: item.title });
  }
  return result;
}

function skipReason(item: PlanItem, run: IssueRun | undefined, skipLabel: string | null | undefined): string | undefined {
  if (skipLabel && item.labels.includes(skipLabel)) return `labelled ${skipLabel}`;
  if (item.blockedBy.length > 0) return `blocked by ${item.blockedBy.map((n) => `#${n}`).join(", ")}`;
  if (run && ACTIVE.includes(run.status)) return `taken by run ${run.id.slice(0, 8)}`;
  // Cancelling writes Ready back; a person who stopped a task decides when it runs again.
  if (run?.status === "cancelled") return "cancelled run; start it by hand";
  return undefined;
}
