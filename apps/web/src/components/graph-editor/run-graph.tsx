"use client";

import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type EdgeTypes, type NodeTypes } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { flowOf } from "@/lib/flow";
import { useFlowColorMode } from "@/lib/use-flow-color-mode";
import type { EdgeRoute, LayoutResult } from "@/lib/elk-layout";
import { cn } from "@/lib/utils";
import { EdgeRoutesContext, useElkLayout, useMeasuredSignature } from "./elk-routes";
import { HandoffEdgeComponent } from "./handoff-edge";
import { HandoffNodeComponent } from "./handoff-node";

const nodeTypes: NodeTypes = { handoff: HandoffNodeComponent };
const edgeTypes: EdgeTypes = { handoff: HandoffEdgeComponent };

const NO_ROUTES: Record<string, EdgeRoute> = {};

export type NodeStatus = { status: string; attempts: number };

type Props = {
  document: unknown;
  statuses: Record<string, NodeStatus>;
  onNodeClick?: (nodeKey: string) => void;
  className?: string;
};

/**
 * The run's pinned graph, read-only, with each node coloured by its latest execution. Laid out
 * with ELK once the nodes are measured, and again when a node's size changes.
 */
function LaidOutRunGraph({ document, statuses, onNodeClick, className }: Props) {
  const flow = useMemo(() => flowOf(document), [document]);
  const colorMode = useFlowColorMode();
  const [layout, setLayout] = useState<LayoutResult>();
  const signature = useMeasuredSignature();
  const runLayout = useElkLayout();
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    runLayout()
      .catch((error: unknown) => {
        // Without a layout the graph still shows, at the positions saved in the editor.
        console.error("ELK layout failed", error);
        return { positions: {}, routes: {} } satisfies LayoutResult;
      })
      .then((result) => {
        if (!cancelled) setLayout(result);
      });
    return () => {
      cancelled = true;
    };
  }, [signature, runLayout]);

  // Fit once React Flow has the laid-out positions, which is a frame after they render.
  useEffect(() => {
    if (!layout) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => void fitView({ padding: 0.08 }));
    });
    return () => cancelAnimationFrame(frame);
  }, [layout, fitView]);

  const nodes = useMemo(
    () =>
      flow.nodes.map((n) => ({
        ...n,
        position: layout?.positions[n.id] ?? n.position,
        data: { ...n.data, ...(statuses[n.id] ?? {}) },
        draggable: false,
        connectable: false,
      })),
    [flow.nodes, statuses, layout],
  );
  return (
    <EdgeRoutesContext.Provider value={layout?.routes ?? NO_ROUTES}>
      <div className={cn("h-80 rounded-md border transition-opacity", layout ? "opacity-100" : "opacity-0", className)}>
        <ReactFlow
          colorMode={colorMode}
          nodes={nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.15}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={onNodeClick ? (_, node) => onNodeClick(node.id) : undefined}
          proOptions={{ hideAttribution: false }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </EdgeRoutesContext.Provider>
  );
}

export function RunGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <LaidOutRunGraph {...props} />
    </ReactFlowProvider>
  );
}
