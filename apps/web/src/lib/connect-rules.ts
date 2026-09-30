export type HandleEnd = { node: string; type: "source" | "target" };

/**
 * Whether a connection dragged from one handle may end on another: an output into an input of a
 * different node. The graph has one edge per pair of nodes, so a connection onto a pair that already
 * has one re-wires that edge (see the editor's connect action) rather than adding a second.
 */
export function canConnect(from: HandleEnd, to: HandleEnd): boolean {
  return from.type !== to.type && from.node !== to.node;
}
