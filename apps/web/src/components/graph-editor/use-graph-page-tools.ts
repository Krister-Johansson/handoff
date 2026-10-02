"use client";

import type { CompileError, FlowGraph } from "@handoff/core";
import { usePageTools } from "@/lib/assistant/use-page-tools";
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

/**
 * The graph editor's page tools: what the assistant or a browser agent can do on the open graph, the
 * same things the canvas and the inspector do, under the same lock.
 */
export function useGraphPageTools({ projectId, graphName, version, graph, selection, setSelection, saved, locked, issues, edit }: Editor) {
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
      page_update_node: undefined,
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
