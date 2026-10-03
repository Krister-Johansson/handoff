import type { CompiledGraph } from "./compile.ts";

/** One visit of a node in a run, as node_executions stores it. */
export type ProgressExecution = { nodeKey: string; status: string; createdAt: Date };

/** A run's steps: how many of its graph's steps have passed, of how many it has. */
export type StepProgress = { done: number; total: number };

/**
 * The nodes a run walks through: those reachable from the start node over non-loop edges, without
 * Start and Finish nodes. A gate reached only when a loop runs out of rounds is not reachable that way.
 */
function steps(graph: CompiledGraph): string[] {
  const reached = new Set([graph.startNode]);
  const queue = [graph.startNode];
  while (queue.length > 0) {
    for (const edge of graph.outEdges(queue.shift()!)) {
      if (edge.loop || reached.has(edge.target)) continue;
      reached.add(edge.target);
      queue.push(edge.target);
    }
  }
  return graph.order.filter((key) => reached.has(key) && graph.node(key).type !== "start" && graph.node(key).type !== "finish");
}

/** The nodes before a node: every node that leads to it over non-loop edges. */
function before(graph: CompiledGraph, key: string): Set<string> {
  const found = new Set<string>();
  const queue = [key];
  while (queue.length > 0) {
    for (const edge of graph.inEdges(queue.shift()!)) {
      if (edge.loop || found.has(edge.source)) continue;
      found.add(edge.source);
      queue.push(edge.source);
    }
  }
  return found;
}

/**
 * How far a run is through its graph. A step is done when its latest execution passed and started
 * after the latest execution of every node before it, so a loop back to an earlier node takes that
 * node and the ones after it out of done until they pass again.
 */
export function stepProgress(graph: CompiledGraph, executions: ProgressExecution[]): StepProgress {
  const ordered = executions.map((execution, index) => ({ execution, index })).sort((a, b) => a.execution.createdAt.getTime() - b.execution.createdAt.getTime() || a.index - b.index);
  const latest = new Map<string, { at: number; passed: boolean }>();
  ordered.forEach(({ execution }, at) => latest.set(execution.nodeKey, { at, passed: execution.status === "passed" }));
  const all = steps(graph);
  const done = all.filter((key) => {
    const own = latest.get(key);
    if (!own?.passed) return false;
    return [...before(graph, key)].every((earlier) => (latest.get(earlier)?.at ?? -1) < own.at);
  });
  return { done: done.length, total: all.length };
}
