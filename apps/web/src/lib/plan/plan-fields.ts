import type { PlanProject } from "@handoff/github";
import type { PlanModeName } from "../project-tab";

/**
 * Which of the fields handoff reads the GitHub Project has: the Start and Target dates, a Size single select
 * with all of S, M and L, and an Estimate number.
 */
export type PlanFieldsPresent = { start: boolean; target: boolean; size: boolean; estimate: boolean };

/** A field of the plan's GitHub Project, by the name it has there. */
export type PlanFieldName = "Start" | "Target" | "Size" | "Estimate";

const NAMES: [keyof PlanFieldsPresent, PlanFieldName][] = [
  ["start", "Start"],
  ["target", "Target"],
  ["size", "Size"],
  ["estimate", "Estimate"],
];

/** The fields each plan mode reads: a Flow project has no dates and no estimates, so only Size. */
export const MODE_FIELDS: Record<PlanModeName, ReadonlySet<keyof PlanFieldsPresent>> = { timeline: new Set(["start", "target", "size", "estimate"]), flow: new Set(["size"]) };

/** The fields a Project has. A Size field without S, M or L counts as missing. */
export function planFieldsOf(project: Pick<PlanProject, "dateFields" | "estimateFields">): PlanFieldsPresent {
  const size = project.estimateFields?.size;
  return {
    start: Boolean(project.dateFields?.start),
    target: Boolean(project.dateFields?.target),
    size: Boolean(size && (["S", "M", "L"] as const).every((s) => size.options[s])),
    estimate: Boolean(project.estimateFields?.estimate),
  };
}

/** The fields the plan mode reads that the Project lacks, in the order Start, Target, Size, Estimate. */
export function missingFields(fields: PlanFieldsPresent, mode: PlanModeName): PlanFieldName[] {
  return NAMES.filter(([key]) => MODE_FIELDS[mode].has(key) && !fields[key]).map(([, name]) => name);
}

/** "no Start field", "no Start or Target field", "no Start, Target or Estimate field". */
export function noFields(names: readonly PlanFieldName[]): string {
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : (names[0] ?? "");
  return `no ${list} field`;
}

/**
 * What a tool says when the plan's Project lacks fields the plan mode reads: which ones, and how to add them.
 * list_plan answers with it, and schedule, set_size and arrange_plan refuse with it.
 */
export function missingFieldsSentence(number: number, names: readonly PlanFieldName[], mode: PlanModeName): string {
  return `GitHub Project #${number} has ${noFields(names)}, which ${mode === "flow" ? "Flow" : "Timeline"} mode reads. Run setup_plan to add ${names.length === 1 ? "it" : "them"}, or a person can press Add the fields in Settings, Projects.`;
}
