import { compileGraph } from "@handoff/core";

/** How a step names the return of an answer-only round: the coder only answered review comments, and the PR step runs again. */
export const ANSWERS_ONLY = "answers only";

/**
 * What started an execution as its step names it: the edge's key, or answers only for an answer-only
 * round's return (a `returned` trigger, or `via: "returned"` on node.created).
 */
export function viaOf(trigger: { kind: string; edgeKey?: string | undefined } | null | undefined): string | null {
  if (trigger?.kind === "edge") return trigger.edgeKey ?? null;
  return trigger?.kind === "returned" ? ANSWERS_ONLY : null;
}

export const viaFromEvent = (via: string | undefined) => (via === "returned" ? ANSWERS_ONLY : (via ?? null));

/**
 * The keys of a graph's loop edges: the ones that send work back (changes, fail, fix, answered). A node
 * that passed and then took one of these sent its work back rather than letting the run go on.
 */
export function loopEdgeKeys(document: unknown): Set<string> {
  const compiled = compileGraph(document);
  const loops = new Set<string>();
  if (!compiled.ok) return loops;
  compiled.graph.graph.forEachEdge((key, attributes) => {
    if (attributes.loop) loops.add(key);
  });
  return loops;
}
