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
};
export type FlowNode = { id: string; type: "handoff"; position: { x: number; y: number }; data: FlowNodeData };
export type FlowEdge = { id: string; source: string; target: string; type: "handoff"; data: EdgeAttributes };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[]; attributes: GraphDocument["attributes"] };

/** graphology export JSON to React Flow nodes and edges. graphology stays the stored model. */
export function toReactFlow(input: unknown): FlowGraph {
  const doc = GraphDocumentSchema.parse(input);
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
      },
    })),
    edges: doc.edges.map(({ key, source, target, attributes }) => ({ id: key, source, target, type: "handoff", data: attributes })),
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
    edges: flow.edges.map((e) => ({ key: e.id, source: e.source, target: e.target, attributes: e.data })),
  });
}
