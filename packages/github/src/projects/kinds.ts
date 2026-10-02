import { PLAN_KINDS, type PlanKind } from "./types.ts";

export { STATUS_OPTIONS } from "./types.ts";

const asKind = (name: string | null | undefined): PlanKind | undefined => {
  const lower = name?.toLowerCase();
  return PLAN_KINDS.find((k) => k === lower);
};

/**
 * An issue's kind: its kind label first, then an issue type named like a kind, then its depth in the
 * sub-issue tree (no parent is an epic, one a story, two a task). Undefined when nothing fits.
 */
export function kindOf(labels: readonly string[], issueType: string | null | undefined, depth: number): PlanKind | undefined {
  for (const label of labels) {
    const kind = asKind(label);
    if (kind) return kind;
  }
  return asKind(issueType) ?? PLAN_KINDS[depth];
}
