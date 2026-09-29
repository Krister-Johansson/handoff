import type { FlowGraph } from "./react-flow.ts";

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 72;
const COLUMN = 340;
const ROW = 130;

/**
 * Layered left-to-right layout: a node's column is the longest non-loop path to it from the start;
 * human gates sit on a row above the main path, because loop edges arc below it.
 */
export function layoutFlow(flow: FlowGraph): FlowGraph {
  const isGate = new Set(flow.nodes.filter((n) => n.data.nodeType === "human_gate").map((n) => n.id));
  const forward = flow.edges.filter((e) => !e.data.loop);
  const depth = new Map<string, number>(flow.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < flow.nodes.length; pass++) {
    let changed = false;
    for (const e of forward) {
      if (isGate.has(e.target)) continue;
      const next = (depth.get(e.source) ?? 0) + 1;
      if (next > (depth.get(e.target) ?? 0)) {
        depth.set(e.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const gate of isGate) {
    const sources = flow.edges.filter((e) => e.target === gate || e.source === gate).map((e) => (e.target === gate ? e.source : e.target));
    const cols = sources.filter((s) => !isGate.has(s)).map((s) => depth.get(s) ?? 0);
    depth.set(gate, cols.length ? Math.min(...cols) : 0);
  }
  // Main path: rows 0, 1, -1, 2, -2 ... per column. Gates: one row above the highest main row.
  const rows = new Map<string, number>();
  const used = new Map<string, number>();
  for (const node of flow.nodes.filter((n) => !isGate.has(n.id))) {
    const col = depth.get(node.id) ?? 0;
    const index = used.get(`main:${col}`) ?? 0;
    used.set(`main:${col}`, index + 1);
    rows.set(node.id, index % 2 === 1 ? Math.ceil(index / 2) : -index / 2);
  }
  const gateRow = Math.min(0, ...rows.values()) - 1;
  for (const node of flow.nodes.filter((n) => isGate.has(n.id))) {
    const col = depth.get(node.id) ?? 0;
    const index = used.get(`gate:${col}`) ?? 0;
    used.set(`gate:${col}`, index + 1);
    rows.set(node.id, gateRow - index);
  }
  return {
    ...flow,
    nodes: flow.nodes.map((n) => ({ ...n, position: { x: (depth.get(n.id) ?? 0) * COLUMN, y: (rows.get(n.id) ?? 0) * ROW } })),
  };
}
