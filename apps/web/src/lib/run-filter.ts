export const RUN_STATUS_FILTERS = [
  { value: undefined, label: "All" },
  { value: "active", label: "Active" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export type RunStatusFilter = "active" | "succeeded" | "failed" | "cancelled";
export type RunFilter = { status?: RunStatusFilter; project?: string };

const STATUSES = new Set<string>(["active", "succeeded", "failed", "cancelled"]);

/** Reads the runs page filter from its search params; anything unknown is ignored. */
export function parseRunFilter(params: Record<string, string | string[] | undefined>): RunFilter {
  const filter: RunFilter = {};
  if (typeof params.status === "string" && STATUSES.has(params.status)) filter.status = params.status as RunStatusFilter;
  if (typeof params.project === "string" && params.project !== "") filter.project = params.project;
  return filter;
}

/** The runs page URL for `current` with `patch` applied; undefined values drop a filter. */
export function runFilterHref(current: RunFilter, patch: Partial<Record<keyof RunFilter, string | undefined>>): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.status) params.set("status", next.status);
  if (next.project) params.set("project", next.project);
  const query = params.toString();
  return query ? `/runs?${query}` : "/runs";
}
