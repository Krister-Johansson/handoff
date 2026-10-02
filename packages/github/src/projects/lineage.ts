import type { IssueAncestorsFragment } from "../gql/graphql.ts";
import { kindOf } from "./kinds.ts";
import type { PlanAncestor } from "./types.ts";

export const present = <T>(items: readonly (T | null | undefined)[] | null | undefined): T[] => (items ?? []).filter((x): x is T => x != null);

/** How many ancestors a parent chain has, counted up to three. */
export function depthOf(parent: { parent?: { parent?: unknown } | null } | null | undefined): number {
  let depth = 0;
  for (let p: { parent?: unknown } | null | undefined = parent; p && depth < 3; p = p.parent as typeof p) depth++;
  return depth;
}

/** The parent and the grandparent of an issue read with the IssueAncestors fields, nearest first. */
export function ancestorsOf(issue: IssueAncestorsFragment): PlanAncestor[] {
  const parent = issue.parent;
  return [parent, parent?.parent].flatMap((p) =>
    p ? [{ number: p.number, title: p.title, body: p.body, kind: kindOf(present(p.labels?.nodes).map((l) => l.name), p.issueType?.name, depthOf(p.parent)) }] : [],
  );
}
