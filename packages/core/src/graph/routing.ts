import { evaluateCondition, type ConditionContext } from "../conditions/evaluate.ts";
import type { CompiledEdge, CompiledGraph } from "./compile.ts";

export type NodeOutcome = "passed" | "failed";

/**
 * Outgoing edges of a finished node that apply to its outcome and whose condition holds.
 * Loop guards and joins are the engine's job; this is pure edge selection.
 */
export function matchingEdges(
  compiled: CompiledGraph,
  nodeKey: string,
  outcome: NodeOutcome,
  ctx: Omit<ConditionContext, "edge">,
): CompiledEdge[] {
  return compiled.outEdges(nodeKey).filter((edge) => {
    if (edge.on !== "any" && edge.on !== outcome) return false;
    if (!edge.condition) return true;
    return evaluateCondition(edge.condition, { ...ctx, edge: { key: edge.key, maxAttempts: edge.maxAttempts } });
  });
}
