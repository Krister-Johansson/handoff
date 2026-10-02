/** What the scheduler's form needs from the page: the project's graphs, its default, and whether its GitHub Project has a Priority field. */
export type SchedulerFormContext = { graphs: string[]; defaultGraph: string | undefined; planNumber: number | null; priority: boolean };

export type SchedulerValues = { maxRuns: number; order: "project" | "priority"; graph: string };

/** start_scheduler's approval sentence, from the fields as they stand. */
export function approvalSentence(project: string, v: SchedulerValues) {
  const order = v.order === "priority" ? "by the Priority field" : "in Project order";
  return `Let handoff start up to ${v.maxRuns} ${v.maxRuns === 1 ? "run" : "runs"} at a time on Ready tasks in ${project}, ${order}, with graph ${v.graph}.`;
}

/** The values a form starts from: the stored settings, or the defaults the first time. */
export function initialValues(settings: { maxRuns: number; order: "project" | "priority"; graphName: string } | undefined, form: SchedulerFormContext): SchedulerValues {
  return { maxRuns: settings?.maxRuns ?? 1, order: settings?.order ?? "project", graph: settings?.graphName ?? form.defaultGraph ?? form.graphs[0] ?? "" };
}

/** "Up to 2 runs, Project order, master": the settings as one line. */
export const settingsLine = (s: { maxRuns: number; order: string; graphName: string }) =>
  `Up to ${s.maxRuns} ${s.maxRuns === 1 ? "run" : "runs"}, ${s.order === "priority" ? "Priority order" : "Project order"}, ${s.graphName}`;
