"use client";

import { nodeCatalog, type CompileError, type FlowGraph, type FlowNode, type NodeType } from "@handoff/core";
import { parseNodePatch } from "@/lib/assistant/page-tools";
import { usePageTools } from "@/lib/assistant/use-page-tools";
import type { LibraryChoices, LibraryKind } from "@/lib/library-choices";
import type { EditorAction } from "./state";

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
};

const keysOf = (graph: FlowGraph) => graph.nodes.map((n) => n.id).join(", ");
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
export function useGraphPageTools({ projectId, graphName, version, graph, selection, setSelection, saved, locked, issues, edit, library }: Editor) {
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
      page_add_node: undefined,
      page_connect: undefined,
      page_remove: undefined,
      page_tidy_layout: undefined,
      page_issues: undefined,
      page_save_graph: undefined,
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
