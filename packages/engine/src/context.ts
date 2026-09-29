import { nodeCatalog, type CheckResult, type CompiledNode, type ContextPacket, type RunState } from "@handoff/core";
import type { NodeExecutionRow } from "@handoff/db";

export const DEFAULT_MAX_TURNS = 60;

function pick(state: RunState, keys: string[]): Record<string, unknown> {
  const source = state as Record<string, unknown>;
  return Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));
}

/** What the node is allowed to believe: a slice of run state, owned paths and its prior failure. */
export function selectContext(node: CompiledNode, state: RunState, execution: NodeExecutionRow): ContextPacket {
  const selector = node.contextSelector;
  const defaultKeys = ["plan", "prNumber", ...(selector.includeFeedback ? ["feedback"] : [])];
  const stateSlice = pick(state, selector.stateKeys.length ? selector.stateKeys : defaultKeys);
  const ownedPaths = state.plan?.ownedPaths ?? [];
  const configTools = node.config.allowedTools;
  const allowedTools = Array.isArray(configTools) ? configTools.map(String) : nodeCatalog[node.type].allowedTools;
  const maxTurns = typeof node.config.maxTurns === "number" ? node.config.maxTurns : DEFAULT_MAX_TURNS;

  const packet: ContextPacket = {
    task: state.task,
    nodeKey: node.key,
    stateSlice,
    repoPaths: selector.repoPaths.length ? selector.repoPaths : ownedPaths,
    constraints: { ownedPaths, allowedTools, maxTurns },
    outputContract: node.contract.output,
  };
  const lastFailure = state.nodes[node.key]?.lastFailure;
  if (selector.includePriorAttempt && lastFailure) {
    packet.priorAttempt = {
      summary: `Attempt ${execution.attempt - 1} failed: ${JSON.stringify(lastFailure.error)}`,
      failedChecks: (lastFailure.checks ?? []) as CheckResult[],
      reviewComments: state.feedback?.review.comments ?? [],
    };
  }
  if (execution.repairNote) packet.repairNote = execution.repairNote;
  return packet;
}
