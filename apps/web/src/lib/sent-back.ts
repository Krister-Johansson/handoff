import { compileGraph } from "@handoff/core";

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
