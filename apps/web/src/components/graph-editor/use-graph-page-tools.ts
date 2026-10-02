"use client";

import { nodeCatalog, portsOf, type CompileError, type FlowGraph, type FlowNode, type NodeType } from "@handoff/core";
import { parseNodePatch } from "@/lib/assistant/page-tools";
import { usePageTools } from "@/lib/assistant/use-page-tools";
import { canConnect } from "@/lib/connect-rules";
import type { LibraryChoices, LibraryKind } from "@/lib/library-choices";
import { NODE_LABELS, nextNodeId, type EditorAction } from "./state";

export type Selection = { nodeId?: string; edgeId?: string };

type Editor = {
  projectId: string;
  graphName: string;
  version: number;
  graph: FlowGraph;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  saved: boolean;
  locked: boolean;
  issues: CompileError[];
  edit: (action: EditorAction) => void;
  library: LibraryChoices;
  /** Saves the graph as its next version, as the Save button does. */
  saveVersion: () => Promise<{ version: number } | { error: string }>;
  /** The middle of the view in graph coordinates, where the palette adds a node. */
  centre: () => { x: number; y: number };
};

/** What a structural page tool answers while the editor is locked. */
const LOCKED = "The graph is locked; unlock it to change its structure.";

const keysOf =(graph: FlowGraph) => graph.nodes.map((n) => n.id).join(", ");
const edgeIdsOf = (graph: FlowGraph) => graph.edges.map((e) => e.id).join(", ") || "none";

/** The node a page tool names by key, or a refusal that lists the keys there are. */
function nodeOf(graph: FlowGraph, key: string) {
  const node = graph.nodes.find((n) => n.id === key);
  if (!node) throw new Error(`There is no node ${key}. The nodes are: ${keysOf(graph)}.`);
  return node;
}

/** The edge a page tool names by id, or a refusal that lists the ids there are. */
function edgeOf(graph: FlowGraph, id: string) {
  const edge = graph.edges.find((e) => e.id === id);
  if (!edge) throw new Error(`There is no edge ${id}. The edges are: ${edgeIdsOf(graph)}.`);
  return edge;
}

/** Library names a change asks for that the project's library does not have, as "skills: x, y". */
function missingFromLibrary(chosen: Partial<Record<LibraryKind, string[]>>, available: LibraryChoices): string[] {
  return (Object.keys(chosen) as LibraryKind[]).flatMap((kind) => {
    const names = new Set(available[kind].map((e) => e.name));
    const missing = (chosen[kind] ?? []).filter((name) => !names.has(name));
    return missing.length ? [`${kind}: ${missing.join(", ")}`] : [];
  });
}

type NodePatch = {
  label?: string;
  library?: Record<LibraryKind, string[]>;
  notify?: Record<string, boolean>;
  checks?: ({ kind: "diff_within_paths" } | { kind: "tests_green"; command: string; passEnv?: string[] })[];
  exhaustedGate?: boolean;
  [setting: string]: unknown;
};

/**
 * The editor actions that make a checked change to a node, as the inspector's fields would: the label,
 * library, notifications and checks on the node, the gate that takes exhausted loops on the graph, the
 * rest in its config, where null removes a setting.
 */
function nodeChanges(graph: FlowGraph, node: FlowNode, patch: NodePatch): EditorAction[] {
  const { label, library, notify, checks, exhaustedGate, ...settings } = patch;
  const set = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== null));
  const cleared = new Set(Object.entries(settings).flatMap(([k, v]) => (v === null ? [k] : [])));
  // A Finish node kept its finished switch in config.notify; setting it moves it to notify.
  if (notify?.finished !== undefined && "notify" in node.data.config) cleared.add("notify");
  const output = node.data.contract?.output ?? nodeCatalog[node.data.nodeType as NodeType].contract;
  const actions: EditorAction[] = [
    {
      type: "updateNode",
      id: node.id,
      patch: {
        ...(label !== undefined ? { label } : {}),
        ...(library ? { library } : {}),
        ...(notify ? { notify: { ...node.data.notify, ...notify } } : {}),
        ...(checks ? { contract: { output, checks: checks.map((c) => (c.kind === "tests_green" ? { timeoutMs: 600_000, ...c } : c)) } } : {}),
        config: set,
      },
    },
  ];
  if (cleared.size) {
    const config = Object.fromEntries(Object.entries({ ...node.data.config, ...set }).filter(([k]) => !cleared.has(k)));
    actions.push({ type: "replaceNodeConfig", id: node.id, config });
  }
  if (exhaustedGate === true) actions.push({ type: "setExhaustedGate", id: node.id });
  if (exhaustedGate === false && graph.attributes.exhaustedGate === node.id) actions.push({ type: "setExhaustedGate", id: undefined });
  return actions;
}

/**
 * The graph editor's page tools: what the assistant or a browser agent can do on the open graph, the
 * same things the canvas and the inspector do, under the same lock.
 */
export function useGraphPageTools({ projectId, graphName, version, graph, selection, setSelection, saved, locked, issues, edit, library, saveVersion, centre }: Editor) {
  /** Refuses a change to the graph's structure while the editor is locked, as the canvas does. */
  const unlocked = () => {
    if (locked) throw new Error(LOCKED);
  };

  /** Selects one node or edge on the canvas and in the inspector, or nothing. */
  const select = (next: Selection) => {
    edit({ type: "nodesChange", changes: graph.nodes.map((n) => ({ id: n.id, type: "select", selected: n.id === next.nodeId })) });
    edit({ type: "edgesChange", changes: graph.edges.map((e) => ({ id: e.id, type: "select", selected: e.id === next.edgeId })) });
    setSelection(next);
  };

  usePageTools(
    "graph_editor",
    {
      page_select: ({ node, edge }) => {
        if (node) {
          const found = nodeOf(graph, node);
          select({ nodeId: found.id });
          return `Selected ${found.id} (${found.data.label}, ${found.data.nodeType}).`;
        }
        if (edge) {
          const found = edgeOf(graph, edge);
          select({ edgeId: found.id });
          return `Selected edge ${found.id} (${found.source} to ${found.target}).`;
        }
        select({});
        return "Cleared the selection.";
      },
      page_get_node: ({ key }) => {
        const node = nodeOf(graph, key);
        const { nodeType, label, isStart, config, library, contract, notify } = node.data;
        const edges = {
          in: graph.edges.filter((e) => e.target === key).map((e) => ({ id: e.id, from: e.source, port: e.data.port ?? null, input: e.data.input ?? "in" })),
          out: graph.edges.filter((e) => e.source === key).map((e) => ({ id: e.id, to: e.target, port: e.data.port ?? null })),
        };
        return JSON.stringify({ key, type: nodeType, label, isStart, config, library: library ?? null, contract: contract ?? null, notify: notify ?? {}, edges });
      },
      page_get_edge: undefined,
      page_update_node: ({ key, patch }) => {
        const node = nodeOf(graph, key);
        const parsed = parseNodePatch(key, node.data.nodeType as NodeType, patch);
        if (!parsed.ok) throw new Error(parsed.message);
        const change = parsed.patch as NodePatch;
        const missing = change.library ? missingFromLibrary(change.library, library) : [];
        if (missing.length) throw new Error(`The project's library has no ${missing.join("; ")}.`);
        for (const action of nodeChanges(graph, node, change)) edit(action);
        return `Changed ${Object.keys(change).join(", ")} of ${key}. The graph is not saved yet.`;
      },
      page_rename_node: undefined,
      page_update_edge: undefined,
      page_add_node: ({ type, position }) => {
        unlocked();
        const start = graph.nodes.find((n) => n.data.nodeType === "start");
        if (type === "start" && start) throw new Error(`The graph already has a Start node, ${start.id}.`);
        const id = nextNodeId(graph, type);
        edit({ type: "addNode", nodeType: type, position: position ? { x: Math.round(position.x), y: Math.round(position.y) } : centre() });
        return `Added ${id} (${NODE_LABELS[type]}). The graph is not saved yet.`;
      },
      page_connect: ({ source, target, port }) => {
        unlocked();
        const from = nodeOf(graph, source);
        const to = nodeOf(graph, target);
        if (!canConnect({ node: from.id, type: "source" }, { node: to.id, type: "target" })) throw new Error("A node cannot connect to itself.");
        const outputs = portsOf(from.data.nodeType, from.data.config).outputs;
        if (!outputs.length) throw new Error(`${source} has no outputs: a Finish ends the graph.`);
        if (!portsOf(to.data.nodeType, to.data.config).inputs.length) throw new Error(`${target} has no input: a Start begins the graph.`);
        const names = outputs.map((o) => o.id).join(", ");
        if (port === undefined && outputs.length > 1) throw new Error(`${source} has several outputs: ${names}. Say which with port.`);
        const output = port === undefined ? outputs[0]! : outputs.find((o) => o.id === port);
        if (!output) throw new Error(`${source} has no output ${port}. Its outputs are: ${names}.`);
        edit({ type: "connect", source, target, sourceHandle: output.id, targetHandle: "in" });
        return `Connected ${source} (${output.id}) to ${target}${output.kind === "feedback" ? ", as feedback" : ""}. The graph is not saved yet.`;
      },
      page_remove: ({ ids }) => {
        unlocked();
        const nodes = new Set(graph.nodes.map((n) => n.id));
        const edges = new Set(graph.edges.map((e) => e.id));
        const unknown = ids.filter((id) => !nodes.has(id) && !edges.has(id));
        if (unknown.length) throw new Error(`There is no node or edge ${unknown.join(", ")}. The nodes are: ${keysOf(graph)}. The edges are: ${edgeIdsOf(graph)}.`);
        const gone = new Set(ids);
        // A node's edges go with it.
        const along = graph.edges.filter((e) => !gone.has(e.id) && (gone.has(e.source) || gone.has(e.target))).map((e) => e.id);
        edit({ type: "remove", ids });
        if ((selection.nodeId && gone.has(selection.nodeId)) || (selection.edgeId && (gone.has(selection.edgeId) || along.includes(selection.edgeId)))) setSelection({});
        return `Removed ${ids.join(", ")}${along.length ? `, and ${along.length === 1 ? "its edge" : "its edges"} ${along.join(", ")}` : ""}. The graph is not saved yet.`;
      },
      page_tidy_layout: undefined,
      page_issues: undefined,
      // Saving is allowed while locked, as the Save button is: the lock guards the structure, not the settings.
      page_save_graph: async () => {
        if (saved) throw new Error(`The graph has no unsaved changes; it is v${version}.`);
        if (issues.length) {
          throw new Error(`The graph has ${issues.length} ${issues.length === 1 ? "issue" : "issues"}, so it cannot be saved: ${issues.map((i) => i.message).join("; ")}`);
        }
        const result = await saveVersion();
        if ("error" in result) throw new Error(`The graph was not saved: ${result.error}`);
        return `Saved ${graphName} as v${result.version}.`;
      },
    },
    () => ({
      projectId,
      graphName,
      version,
      saved,
      locked,
      selection: { ...(selection.nodeId ? { node: selection.nodeId } : {}), ...(selection.edgeId ? { edge: selection.edgeId } : {}) },
      nodes: graph.nodes.map((n) => ({ key: n.id, type: n.data.nodeType, label: n.data.label, isStart: n.data.isStart })),
      edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, port: e.data.port ?? null, loop: e.data.loop })),
      issues: issues.map((i) => i.message),
    }),
  );
}
