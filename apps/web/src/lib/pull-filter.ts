import type { PullFilter } from "@/server/pulls";

export const PULL_FILTERS: { value: PullFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
  { value: "archived", label: "Archived" },
];

/** The pull request filter from the project page's ?pr=; open unless another known filter is asked for. */
export function parsePullFilter(params: Record<string, string | string[] | undefined>): PullFilter {
  const pr = params.pr;
  return typeof pr === "string" && PULL_FILTERS.some((f) => f.value === pr) ? (pr as PullFilter) : "open";
}
