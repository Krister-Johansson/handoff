import { applyEdgeChanges, applyNodeChanges, type EdgeChange, type NodeChange } from "@xyflow/react";
import { compileGraph, CUSTOM_HANDLE, fromReactFlow, gateMode, portKind, type CompileError, type EdgeAttributes, type FlowEdge, type FlowGraph, type FlowNode, type FlowNodeData, type NodeType } from "@handoff/core";

export const NODE_LABELS: Record<NodeType, string> = {
  start: "Start",
  planner: "Planner",
  coder: "Coder",
  reviewer: "Reviewer",
  code_review: "Code review",
  tester: "Tester",
  pr: "Pull request",
  merge: "Merge",
  human_gate: "Human gate",
  finish: "Finish",
  function: "Function",
};

export type EditorAction =
  | { type: "nodesChange"; changes: NodeChange<FlowNode>[] }
  | { type: "edgesChange"; changes: EdgeChange<FlowEdge>[] }
  | { type: "connect"; source: string; target: string; sourceHandle?: string | null | undefined; targetHandle?: string | null | undefined }
  | { type: "addNode"; nodeType: NodeType; position: { x: number; y: number } }
  | { type: "updateNode"; id: string; patch: Partial<Omit<FlowNodeData, "config">> & { config?: Record<string, unknown> } }
  | { type: "replaceNodeConfig"; id: string; config: Record<string, unknown> }
  | { type: "updateEdge"; id: string; patch: Partial<EdgeAttributes> }
  | { type: "setStart"; id: string }
  | { type: "setExhaustedGate"; id: string | undefined }
  | { type: "remove"; ids: string[] }
  | { type: "renameNode"; id: string; to: string }
  | { type: "applyLayout"; positions: Record<string, { x: number; y: number }> }
  | { type: "reset"; graph: FlowGraph };

function uniqueId(taken: Set<string>, base: string, first: number): string {
  let n = first;
  let id = `${base}-${n}`;
  while (taken.has(id)) id = `${base}-${++n}`;
  return id;
}

/** A human gate's output that stands for "go on" in each mode. */
const GO_ON = { approval: "approve", question: "answered" } as const;

/**
 * When a human gate switches mode its outputs change, so edges leaving its old "go on" port move to
 * the new one (approve and answered). Edges from other ports stay, and show an issue if they no longer fit.
 */
function withGatePorts(before: FlowGraph, nodes: FlowNode[], id: string): FlowEdge[] {
  const was = before.nodes.find((n) => n.id === id);
  const now = nodes.find((n) => n.id === id);
  if (!was || !now || now.data.nodeType !== "human_gate") return before.edges;
  const from = GO_ON[gateMode(was.data.config)];
  const to = GO_ON[gateMode(now.data.config)];
  if (from === to) return before.edges;
  const input = portKind("human_gate", now.data.config, to) === "feedback" ? "feedback" : "in";
  return before.edges.map((e) => (e.source === id && e.data.port === from ? { ...e, sourceHandle: to, data: { ...e.data, port: to, input } } : e));
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
      // The source handle is the output port; an edge without one has a custom condition. Every node has
      // one input, and the port's kind says whether the edge continues the work or sends feedback.
      const port = action.sourceHandle && action.sourceHandle !== CUSTOM_HANDLE ? action.sourceHandle : undefined;
      const source = state.nodes.find((n) => n.id === action.source);
      const kind = source ? portKind(source.data.nodeType, source.data.config, port) : undefined;
      const input: "in" | "feedback" | undefined = kind === "feedback" ? "feedback" : port ? "in" : undefined;
      const existing = state.edges.find((e) => e.source === action.source && e.target === action.target);
      if (existing) {
        // One edge per pair: re-wire it to the new ports. The new port decides routing, so a custom condition goes.
        const { loop, priority, maxAttempts, onExhausted, overrides } = existing.data;
        const data = {
          on: "passed" as const,
          loop,
          priority,
          ...(maxAttempts !== undefined ? { maxAttempts } : {}),
          ...(onExhausted !== undefined ? { onExhausted } : {}),
          ...(overrides !== undefined ? { overrides } : {}),
          ...(port ? { port } : {}),
          ...(input ? { input } : {}),
        };
        const rewired: FlowEdge = { ...existing, sourceHandle: port ?? CUSTOM_HANDLE, targetHandle: "in", data };
        return { ...state, edges: state.edges.map((e) => (e.id === existing.id ? rewired : e)) };
      }
      const id = `${action.source}->${action.target}`;
      const edge: FlowEdge = {
        id,
        source: action.source,
        target: action.target,
        sourceHandle: port ?? CUSTOM_HANDLE,
        targetHandle: "in",
        type: "handoff",
        data: { on: "passed", loop: false, priority: 0, ...(port ? { port } : {}), ...(input ? { input } : {}) },
      };
      return { ...state, edges: [...state.edges, edge] };
    }
    case "addNode": {
      // A graph has at most one Start.
      if (action.nodeType === "start" && state.nodes.some((n) => n.data.nodeType === "start")) return state;
      const taken = new Set(state.nodes.map((n) => n.id));
      const count = state.nodes.filter((n) => n.data.nodeType === action.nodeType).length;
      const id = uniqueId(taken, action.nodeType, count + 1);
      const isStart = state.nodes.length === 0 || action.nodeType === "start";
      const config = action.nodeType === "start" ? { trigger: "run" } : action.nodeType === "finish" ? { notify: true } : {};
      const node: FlowNode = {
        id,
        type: "handoff",
        position: action.position,
        data: { nodeType: action.nodeType, label: NODE_LABELS[action.nodeType], isStart, config },
      };
      if (!isStart) return { ...state, nodes: [...state.nodes, node] };
      // A new Start takes over from the step the run started at, and leads into it.
      const previous = state.nodes.find((n) => n.id === state.attributes.startNode);
      const nodes = [...state.nodes.map((n) => (n.data.isStart ? { ...n, data: { ...n.data, isStart: false } } : n)), node];
      const lead: FlowEdge[] =
        action.nodeType === "start" && previous
          ? [{ id: `${id}->${previous.id}`, source: id, target: previous.id, sourceHandle: "run", targetHandle: "in", type: "handoff", data: { on: "passed", loop: false, priority: 0, port: "run", input: "in" } }]
          : [];
      return { ...state, attributes: { ...state.attributes, startNode: id }, nodes, edges: [...state.edges, ...lead] };
    }
    case "updateNode": {
      const nodes = state.nodes.map((n) =>
        n.id === action.id ? { ...n, data: { ...n.data, ...action.patch, config: { ...n.data.config, ...(action.patch.config ?? {}) } } } : n,
      );
      return { ...state, nodes, edges: withGatePorts(state, nodes, action.id) };
    }
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
    case "applyLayout":
      return { ...state, nodes: state.nodes.map((n) => (action.positions[n.id] ? { ...n, position: action.positions[n.id]! } : n)) };
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
