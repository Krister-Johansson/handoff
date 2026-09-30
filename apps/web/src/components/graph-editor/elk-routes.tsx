"use client";

import { useReactFlow, useStore, type Edge, type Node } from "@xyflow/react";
import { createContext, useCallback, useContext } from "react";
import type { EdgeAttributes } from "@handoff/core";
import { elkLayout, type EdgeRoute, type LayoutResult } from "@/lib/elk-layout";
import { edgeLabel } from "./edge-geometry";

/** Edge routes from the last ELK layout, by edge id. Kept out of the graph document. */
export const EdgeRoutesContext = createContext<Record<string, EdgeRoute>>({});
export const useEdgeRoute = (id: string): EdgeRoute | undefined => useContext(EdgeRoutesContext)[id];

/**
 * Changes whenever a node is added, removed or changes size, so a layout can be recomputed; empty
 * until every node has been measured. Reads React Flow's internal nodes, which carry the measured
 * size even when the caller's nodes do not (a flow without onNodesChange never receives it).
 */
export function useMeasuredSignature(): string {
  return useStore(
    (s) => {
      const nodes = [...s.nodeLookup.values()];
      if (nodes.length === 0 || nodes.some((n) => !n.measured.width || !n.measured.height)) return "";
      return nodes.map((n) => `${n.id}:${Math.round(n.measured.width!)}x${Math.round(n.measured.height!)}`).join("|");
    },
    // New node objects (after a layout moves them) are re-measured; keep the last full signature meanwhile.
    (previous, next) => previous === next || (next === "" && previous !== ""),
  );
}

/** Runs ELK over the flow's current nodes, at their measured sizes, and edges. */
export function useElkLayout(): () => Promise<LayoutResult> {
  const { getNodes, getEdges, getInternalNode } = useReactFlow<Node, Edge<EdgeAttributes>>();
  return useCallback(
    () =>
      elkLayout({
        nodes: getNodes().map((n) => {
          const measured = getInternalNode(n.id)?.measured;
          return { id: n.id, width: measured?.width ?? 208, height: measured?.height ?? 76 };
        }),
        edges: getEdges().map((e) => ({ id: e.id, source: e.source, target: e.target, label: edgeLabel(e.data) || undefined, loop: e.data?.loop })),
      }),
    [getNodes, getEdges, getInternalNode],
  );
}
