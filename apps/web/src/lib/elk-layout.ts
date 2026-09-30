import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";

export type Point = { x: number; y: number };
export type EdgeRoute = { points: Point[]; label?: { x: number; y: number; width: number; height: number } };
/** A node's handle, where React Flow measured it: x and y from the node's top left. */
export type LayoutHandle = { id: string; type: "source" | "target"; x: number; y: number };
export type LayoutInput = {
  nodes: { id: string; width: number; height: number; handles?: LayoutHandle[] | undefined }[];
  edges: {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null | undefined;
    targetHandle?: string | null | undefined;
    label?: string | undefined;
    loop?: boolean | undefined;
  }[];
};
export type LayoutResult = { positions: Record<string, Point>; routes: Record<string, EdgeRoute> };

/** Edge labels are 10px monospace with 6px padding and a border; ELK needs their size up front. */
const LABEL_CHAR_WIDTH = 6.1;
const LABEL_PADDING = 14;
const LABEL_HEIGHT = 20;
export const MAX_LABEL_CHARS = 48;

export const labelWidth = (text: string) => Math.ceil(Math.min(text.length, MAX_LABEL_CHARS) * LABEL_CHAR_WIDTH + LABEL_PADDING);

const elk = new ELK();

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "60",
  "elk.layered.spacing.edgeNodeBetweenLayers": "16",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
  "elk.spacing.nodeNode": "48",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "14",
  "elk.spacing.edgeLabel": "4",
  "elk.edgeLabels.placement": "CENTER",
  "elk.edgeLabels.inline": "true",
  "elk.layered.edgeLabels.centerLabelPlacementStrategy": "WIDEST_LAYER",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  // Nodes arrive in topological order over forward edges, so the edges that run against that order are the loops.
  "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
  // Keep the graph's own node and edge order when it does not cost crossings, so layouts are stable.
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
};

/** Nodes ordered along forward (non-loop) edges; nodes on no forward path keep their input order at the end. */
function topological(input: LayoutInput): LayoutInput["nodes"] {
  const forward = input.edges.filter((e) => !e.loop);
  const indegree = new Map(input.nodes.map((n) => [n.id, 0]));
  for (const e of forward) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const queue = input.nodes.filter((n) => indegree.get(n.id) === 0);
  const ordered: LayoutInput["nodes"] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);
    for (const e of forward.filter((f) => f.source === node.id)) {
      indegree.set(e.target, (indegree.get(e.target) ?? 0) - 1);
      const target = byId.get(e.target);
      if (target && indegree.get(e.target) === 0) queue.push(target);
    }
  }
  return [...ordered, ...input.nodes.filter((n) => !seen.has(n.id))];
}

const inPort = (id: string) => `${id}__in`;
const outPort = (id: string) => `${id}__out`;
const handlePort = (node: string, type: LayoutHandle["type"], handle: string) => `${node}__${type}__${handle}`;

/**
 * Layered left-to-right layout with ELK. Every node has one ELK port per measured handle, plus a
 * port in the middle of each side for edges without a handle, so the routes ELK returns start and
 * end where React Flow draws the handles. Loop edges are routed back around the nodes instead of
 * through them.
 */
export async function elkLayout(input: LayoutInput): Promise<LayoutResult> {
  const handles = new Map(input.nodes.map((n) => [n.id, new Set((n.handles ?? []).map((h) => handlePort(n.id, h.type, h.id)))]));
  const sourcePort = (e: LayoutInput["edges"][number]) => {
    const port = e.sourceHandle ? handlePort(e.source, "source", e.sourceHandle) : "";
    return handles.get(e.source)?.has(port) ? port : outPort(e.source);
  };
  const targetPort = (e: LayoutInput["edges"][number]) => {
    const port = e.targetHandle ? handlePort(e.target, "target", e.targetHandle) : "";
    return handles.get(e.target)?.has(port) ? port : inPort(e.target);
  };
  const graph: ElkNode = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: topological(input).map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: [
        { id: inPort(n.id), x: 0, y: n.height / 2, width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" } },
        { id: outPort(n.id), x: n.width, y: n.height / 2, width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" } },
        ...(n.handles ?? []).map((h) => ({
          id: handlePort(n.id, h.type, h.id),
          x: h.type === "source" ? n.width : 0,
          y: h.y,
          width: 0,
          height: 0,
          layoutOptions: { "elk.port.side": h.type === "source" ? "EAST" : "WEST" },
        })),
      ],
    })),
    edges: input.edges.map(
      (e): ElkExtendedEdge => ({
        id: e.id,
        sources: [sourcePort(e)],
        targets: [targetPort(e)],
        // Forward edges stay as straight as possible so the main path reads as one line.
        ...(e.loop ? {} : { layoutOptions: { "elk.layered.priority.straightness": "10", "elk.layered.priority.direction": "10" } }),
        ...(e.label ? { labels: [{ id: `${e.id}__label`, text: e.label, width: labelWidth(e.label), height: LABEL_HEIGHT }] } : {}),
      }),
    ),
  };
  const laidOut = await elk.layout(graph);
  const positions: Record<string, Point> = {};
  for (const child of laidOut.children ?? []) positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  const routes: Record<string, EdgeRoute> = {};
  for (const edge of laidOut.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section) continue;
    const label = edge.labels?.[0];
    routes[edge.id] = {
      points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: p.x, y: p.y })),
      ...(label ? { label: { x: label.x ?? 0, y: label.y ?? 0, width: label.width ?? 0, height: label.height ?? 0 } } : {}),
    };
  }
  return { positions, routes };
}
