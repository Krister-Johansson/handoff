import type { PrioritySource } from "@handoff/github";

/**
 * What the scheduler's form needs from the page: the project's graphs, its default, and where its Priority comes
 * from, the Project's own Priority field or the organization's Priority issue field; undefined with neither.
 */
export type SchedulerFormContext = { graphs: string[]; defaultGraph: string | undefined; planNumber: number | null; priority: PrioritySource | undefined };

export type SchedulerValues = { maxRuns: number; order: "project" | "priority"; graph: string };

/** The field Priority order reads, as a phrase: "the organization's Priority issue field" or "the Project's Priority field". */
export const priorityField = (source: PrioritySource | undefined) => (source === "issue-field" ? "the organization's Priority issue field" : "the Project's Priority field");

/** start_scheduler's approval sentence, from the fields as they stand. */
export function approvalSentence(project: string, v: SchedulerValues, source?: PrioritySource) {
  const order = v.order === "priority" ? `by ${source ? priorityField(source) : "the Priority field"}` : "in Project order";
  return `Let handoff start up to ${v.maxRuns} ${v.maxRuns === 1 ? "run" : "runs"} at a time on Ready tasks in ${project}, ${order}, with graph ${v.graph}.`;
}

/** The values a form starts from: the stored settings, or the defaults the first time. */
export function initialValues(settings: { maxRuns: number; order: "project" | "priority"; graphName: string } | undefined, form: SchedulerFormContext): SchedulerValues {
  return { maxRuns: settings?.maxRuns ?? 1, order: settings?.order ?? "project", graph: settings?.graphName ?? form.defaultGraph ?? form.graphs[0] ?? "" };
}

/** "Up to 2 runs, Project order, master": the settings as one line; Priority order names its field when `source` is known. */
export const settingsLine = (s: { maxRuns: number; order: string; graphName: string }, source?: PrioritySource) =>
  `Up to ${s.maxRuns} ${s.maxRuns === 1 ? "run" : "runs"}, ${s.order === "priority" ? `Priority order${source ? ` from ${priorityField(source)}` : ""}` : "Project order"}, ${s.graphName}`;
