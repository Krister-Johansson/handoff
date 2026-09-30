import { GraphDocumentSchema, type EdgeAttributes, type GraphDocument, type NodeAttributesInput } from "../schema/graph.ts";

/** Plain shapes compatible with @xyflow/react Node and Edge, so core does not depend on React. */
export type FlowNodeData = {
  nodeType: string;
  label: string;
  isStart: boolean;
  config: Record<string, unknown>;
  contract?: NodeAttributesInput["contract"];
  contextSelector?: NodeAttributesInput["contextSelector"];
  library?: NodeAttributesInput["library"];
  /** An outgoing edge has no port (a custom condition), so the node shows a handle for it. */
  customOut?: boolean;
};
export type FlowNode = { id: string; type: "handoff"; position: { x: number; y: number }; data: FlowNodeData };
export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  /** The source's output port, or CUSTOM_HANDLE for an edge with a custom condition. */
  sourceHandle?: string | null;
  /** The target's input handle: every node has one, `in`. */
  targetHandle?: string | null;
  type: "handoff";
  data: EdgeAttributes;
};

/** The handle of an edge that has no port: its route comes from a custom condition. */
export const CUSTOM_HANDLE = "custom";
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[]; attributes: GraphDocument["attributes"] };

/** graphology export JSON to React Flow nodes and edges. graphology stays the stored model. */
export function toReactFlow(input: unknown): FlowGraph {
  const doc = GraphDocumentSchema.parse(input);
  const customOut = new Set(doc.edges.filter((e) => e.attributes.port === undefined).map((e) => e.source));
  return {
    attributes: doc.attributes,
    nodes: doc.nodes.map(({ key, attributes }) => ({
      id: key,
      type: "handoff",
      position: { x: attributes.x, y: attributes.y },
      data: {
        nodeType: attributes.type,
        label: attributes.label ?? key,
        isStart: doc.attributes.startNode === key,
        config: attributes.config,
        ...(attributes.contract ? { contract: attributes.contract } : {}),
        ...(attributes.contextSelector ? { contextSelector: attributes.contextSelector } : {}),
        ...(attributes.library ? { library: attributes.library } : {}),
        ...(customOut.has(key) ? { customOut: true } : {}),
      },
    })),
    edges: doc.edges.map(({ key, source, target, attributes }) => ({
      id: key,
      source,
      target,
      sourceHandle: attributes.port ?? CUSTOM_HANDLE,
      targetHandle: "in",
      type: "handoff",
      data: attributes,
    })),
  };
}

/** React Flow state back to graphology export JSON. Positions are rounded to whole pixels. */
export function fromReactFlow(flow: FlowGraph): GraphDocument {
  const start = flow.nodes.find((n) => n.data.isStart)?.id ?? flow.attributes.startNode;
  return GraphDocumentSchema.parse({
    attributes: { ...flow.attributes, startNode: start },
    options: { type: "directed", multi: false, allowSelfLoops: false },
    nodes: flow.nodes.map((n) => ({
      key: n.id,
      attributes: {
        type: n.data.nodeType,
        label: n.data.label,
        config: n.data.config,
        ...(n.data.contract ? { contract: n.data.contract } : {}),
        ...(n.data.contextSelector ? { contextSelector: n.data.contextSelector } : {}),
        ...(n.data.library ? { library: n.data.library } : {}),
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
      },
    })),
    edges: flow.edges.map((e) => {
      const { port: _port, input: _input, ...rest } = e.data;
      const port = e.sourceHandle && e.sourceHandle !== CUSTOM_HANDLE ? e.sourceHandle : undefined;
      // The input (in or feedback) is kept from the edge's data: the editor sets it from the port's kind.
      const input = e.targetHandle === "feedback" ? "feedback" : e.data.input;
      return { key: e.id, source: e.source, target: e.target, attributes: { ...rest, ...(port ? { port } : {}), ...(input ? { input } : {}) } };
    }),
  });
}
