import type { PlanKind, PlanSize, PlanStatus } from "./types.ts";

/** The Status options of a plan's GitHub Project, in board order. */
export const STATUS_OPTIONS = ["Shaping", "Ready", "Running", "In review", "Done"] as const;

/** The kinds of issue in a plan, from the top of the hierarchy down; also the kind labels' names. */
export const PLAN_KINDS = ["epic", "story", "task"] as const;

/** handoff's sizes: the options of a Project's Size field it reads and writes, smallest first. */
export const PLAN_SIZES = ["S", "M", "L"] as const;

/** The size a Size option's name stands for; undefined for any other option, such as "🦑 Large". */
export const sizeOf = (name: string | null | undefined): PlanSize | undefined => PLAN_SIZES.find((s) => s === name);

/** The plan status a Status option's name stands for; undefined for an option handoff does not know. */
export const statusOf = (name: string | null | undefined): PlanStatus | undefined => STATUS_OPTIONS.find((s) => s === name);

const asKind = (name: string | null | undefined): PlanKind | undefined => {
  const lower = name?.toLowerCase();
  return PLAN_KINDS.find((k) => k === lower);
};

/**
 * An issue's kind: its kind label first, then an issue type named like a kind, then its depth in the
 * sub-issue tree (no parent is an epic, one a story, two a task). Undefined when nothing fits.
 * An organization's default issue types are Task, Bug and Feature: a kind label still wins over Task,
 * Task alone makes a task at any depth, and Bug or Feature leave the kind to the depth.
 */
export function kindOf(labels: readonly string[], issueType: string | null | undefined, depth: number): PlanKind | undefined {
  for (const label of labels) {
    const kind = asKind(label);
    if (kind) return kind;
  }
  return asKind(issueType) ?? PLAN_KINDS[depth];
}
