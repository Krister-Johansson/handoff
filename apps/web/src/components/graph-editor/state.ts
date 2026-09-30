import { applyEdgeChanges, applyNodeChanges, type EdgeChange, type NodeChange } from "@xyflow/react";
import { compileGraph, fromReactFlow, layoutFlow, type CompileError, type EdgeAttributes, type FlowEdge, type FlowGraph, type FlowNode, type FlowNodeData, type NodeType } from "@handoff/core";

export const NODE_LABELS: Record<NodeType, string> = {
  planner: "Planner",
  coder: "Coder",
  reviewer: "Reviewer",
  tester: "Tester",
  pr: "Pull request",
  merge: "Merge",
  human_gate: "Human gate",
  function: "Function",
};

export type EditorAction =
  | { type: "nodesChange"; changes: NodeChange<FlowNode>[] }
  | { type: "edgesChange"; changes: EdgeChange<FlowEdge>[] }
  | { type: "connect"; source: string; target: string }
  | { type: "addNode"; nodeType: NodeType; position: { x: number; y: number } }
  | { type: "updateNode"; id: string; patch: Partial<Omit<FlowNodeData, "config">> & { config?: Record<string, unknown> } }
  | { type: "replaceNodeConfig"; id: string; config: Record<string, unknown> }
  | { type: "updateEdge"; id: string; patch: Partial<EdgeAttributes> }
  | { type: "setStart"; id: string }
  | { type: "setExhaustedGate"; id: string | undefined }
  | { type: "remove"; ids: string[] }
  | { type: "renameNode"; id: string; to: string }
  | { type: "layout" }
  | { type: "reset"; graph: FlowGraph };

function uniqueId(taken: Set<string>, base: string, first: number): string {
  let n = first;
  let id = `${base}-${n}`;
  while (taken.has(id)) id = `${base}-${++n}`;
  return id;
}

/** Pure editor state transitions over the React Flow view of a graphology document. */
export function editorReducer(state: FlowGraph, action: EditorAction): FlowGraph {
  switch (action.type) {
    case "nodesChange": {
      const nodes = applyNodeChanges(action.changes, state.nodes);
      const alive = new Set(nodes.map((n) => n.id));
      return { ...state, nodes, edges: state.edges.filter((e) => alive.has(e.source) && alive.has(e.target)) };
    }
    case "edgesChange":
      return { ...state, edges: applyEdgeChanges(action.changes, state.edges) };
    case "connect": {
      const taken = new Set(state.edges.map((e) => e.id));
      const base = `${action.source}->${action.target}`;
      const id = taken.has(base) ? uniqueId(taken, base, 2) : base;
      const edge: FlowEdge = { id, source: action.source, target: action.target, type: "handoff", data: { on: "passed", loop: false, priority: 0 } };
      return { ...state, edges: [...state.edges, edge] };
    }
    case "addNode": {
      const taken = new Set(state.nodes.map((n) => n.id));
      const count = state.nodes.filter((n) => n.data.nodeType === action.nodeType).length;
      const id = uniqueId(taken, action.nodeType, count + 1);
      const node: FlowNode = {
        id,
        type: "handoff",
        position: action.position,
        data: { nodeType: action.nodeType, label: NODE_LABELS[action.nodeType], isStart: state.nodes.length === 0, config: {} },
      };
      return {
        ...state,
        attributes: state.nodes.length === 0 ? { ...state.attributes, startNode: id } : state.attributes,
        nodes: [...state.nodes, node],
      };
    }
    case "updateNode":
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.id ? { ...n, data: { ...n.data, ...action.patch, config: { ...n.data.config, ...(action.patch.config ?? {}) } } } : n,
        ),
      };
    case "replaceNodeConfig":
      return { ...state, nodes: state.nodes.map((n) => (n.id === action.id ? { ...n, data: { ...n.data, config: action.config } } : n)) };
    case "updateEdge":
      return {
        ...state,
        edges: state.edges.map((e) => {
          if (e.id !== action.id) return e;
          const data = { ...e.data, ...action.patch };
          for (const key of Object.keys(action.patch) as (keyof EdgeAttributes)[]) if (action.patch[key] === undefined) delete data[key];
          return { ...e, data };
        }),
      };
    case "setStart":
      return {
        ...state,
        attributes: { ...state.attributes, startNode: action.id },
        nodes: state.nodes.map((n) => ({ ...n, data: { ...n.data, isStart: n.id === action.id } })),
      };
    case "setExhaustedGate": {
      const attributes = { ...state.attributes };
      if (action.id) attributes.exhaustedGate = action.id;
      else delete attributes.exhaustedGate;
      return { ...state, attributes };
    }
    case "remove": {
      const ids = new Set(action.ids);
      const nodes = state.nodes.filter((n) => !ids.has(n.id));
      const alive = new Set(nodes.map((n) => n.id));
      return { ...state, nodes, edges: state.edges.filter((e) => !ids.has(e.id) && alive.has(e.source) && alive.has(e.target)) };
    }
    case "renameNode":
      return renameNode(state, action.id, action.to);
    case "layout":
      return layoutFlow(state);
    case "reset":
      return action.graph;
  }
}

export const documentOf = (state: FlowGraph) => fromReactFlow(state);

/** Compile errors for the current editor state, including schema errors from invalid edits. */
export function issuesOf(state: FlowGraph): CompileError[] {
  let doc: unknown;
  try {
    doc = documentOf(state);
  } catch (error) {
    return [{ code: "invalid_document", message: (error as Error).message.slice(0, 300) }];
  }
  const result = compileGraph(doc);
  return result.ok ? [] : result.errors;
}

const KEY = /^[A-Za-z0-9_-]+$/;

/** Renames a node key everywhere it is referenced: edges (and their derived keys), start node, gates. */
function renameNode(state: FlowGraph, from: string, to: string): FlowGraph {
  if (from === to || !KEY.test(to) || state.nodes.some((n) => n.id === to) || !state.nodes.some((n) => n.id === from)) return state;
  const swap = (key: string) => (key === from ? to : key);
  const edges = state.edges.map((e) => {
    const source = swap(e.source);
    const target = swap(e.target);
    const derived = /^(.+)->(.+?)(-\d+)?$/.exec(e.id);
    const id = derived && derived[1] === e.source && (derived[2] === e.target) ? `${source}->${target}${derived[3] ?? ""}` : e.id;
    const data = e.data.onExhausted === from ? { ...e.data, onExhausted: to } : e.data;
    return { ...e, id, source, target, data };
  });
  const attributes = {
    ...state.attributes,
    startNode: swap(state.attributes.startNode),
    ...(state.attributes.exhaustedGate ? { exhaustedGate: swap(state.attributes.exhaustedGate) } : {}),
  };
  return { ...state, attributes, edges, nodes: state.nodes.map((n) => (n.id === from ? { ...n, id: to } : n)) };
}

/** Whether an action changes the stored document; React Flow's measure and select changes do not. */
export function changesEdit(action: EditorAction): boolean {
  if (action.type === "nodesChange") return action.changes.some((c) => c.type !== "dimensions" && c.type !== "select");
  if (action.type === "edgesChange") return action.changes.some((c) => c.type !== "select");
  return action.type !== "reset";
}
