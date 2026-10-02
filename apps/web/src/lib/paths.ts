import type { PlanStatus } from "@handoff/github";
import type { PlanViewName } from "./project-tab";

/** A project's Plan page, with the view (the tree unless given), an epic and statuses to narrow it to. */
export function planPath(projectId: string, opts: { view?: PlanViewName; epic?: number; status?: PlanStatus[] } = {}) {
  const query = [
    opts.view && opts.view !== "tree" ? `view=${opts.view}` : undefined,
    opts.epic !== undefined ? `epic=${opts.epic}` : undefined,
    opts.status?.length ? `status=${opts.status.map(encodeURIComponent).join(",")}` : undefined,
  ].filter(Boolean);
  return `/projects/${projectId}/plan${query.length ? `?${query.join("&")}` : ""}`;
}

// A run's, a review's and a Try it page's paths live in core, where the engine writes notification links with them.
export { reviewPath, runPath, tryPath } from "@handoff/core/paths";
