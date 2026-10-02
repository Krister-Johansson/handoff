import type { PlanStatus } from "@handoff/github";
import type { RunFilter } from "./plan/filters";
import type { PlanViewName } from "./project-tab";

/** A project's Plan page, with the view (the tree unless given), an epic (or the unplanned issues), statuses and a run filter to narrow it to. */
export function planPath(projectId: string, opts: { view?: PlanViewName; epic?: number | "unplanned"; status?: PlanStatus[]; run?: RunFilter } = {}) {
  const query = [
    opts.view && opts.view !== "tree" ? `view=${opts.view}` : undefined,
    opts.epic !== undefined ? `epic=${opts.epic}` : undefined,
    opts.status?.length ? `status=${opts.status.map(encodeURIComponent).join(",")}` : undefined,
    opts.run && opts.run !== "any" ? `run=${opts.run}` : undefined,
  ].filter(Boolean);
  return `/projects/${projectId}/plan${query.length ? `?${query.join("&")}` : ""}`;
}

/** A run's page, under the project it belongs to. */
export const runPath = (projectId: string, runId: string) => `/projects/${projectId}/runs/${runId}`;

/** A review question's page, under its run. */
export const reviewPath = (projectId: string, runId: string, questionId: string) => `${runPath(projectId, runId)}/review/${questionId}`;

/** A Try it gate's page, where a person checks the run's app against its acceptance criteria. */
export const tryPath = (projectId: string, runId: string, questionId: string) => `${runPath(projectId, runId)}/try/${questionId}`;
