/** A run's status, as the database stores it. */
export type RunStatusName = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";

/** The filters of a project's Runs page, kept in ?status=; without one the page lists every run. */
export type RunsFilter = "active" | "waiting" | "failed" | "done";

/** Each filter with its label and the statuses it lists: cancelled runs count as done. */
export const RUNS_FILTERS: { value: RunsFilter; label: string; statuses: RunStatusName[] }[] = [
  { value: "active", label: "Active", statuses: ["queued", "running"] },
  { value: "waiting", label: "Waiting", statuses: ["waiting"] },
  { value: "failed", label: "Failed", statuses: ["failed"] },
  { value: "done", label: "Done", statuses: ["succeeded", "cancelled"] },
];

/** The Runs page filter from ?status=; undefined, every run, unless a known filter is asked for. */
export function parseRunsFilter(params: Record<string, string | string[] | undefined>): RunsFilter | undefined {
  const status = params.status;
  return RUNS_FILTERS.find((f) => f.value === status)?.value;
}
