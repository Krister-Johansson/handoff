export type HandleEnd = { node: string; type: "source" | "target" };

/**
 * Whether a connection dragged from one handle may end on another: an output into an input of a
 * different node, and at most one edge between two nodes, since the graph is simple.
 */
export function canConnect(from: HandleEnd, to: HandleEnd, edges: readonly { source: string; target: string }[]): boolean {
  if (from.type === to.type || from.node === to.node) return false;
  const [source, target] = from.type === "source" ? [from.node, to.node] : [to.node, from.node];
  return !edges.some((e) => e.source === source && e.target === target);
}
