"use client";

import { Background, ControlButton, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type EdgeTypes, type NodeTypes } from "@xyflow/react";
import { LocateFixedIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { flowOf } from "@/lib/flow";
import { useFlowColorMode } from "@/lib/use-flow-color-mode";
import { followTargets, useFollow } from "@/lib/use-follow";
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
  /** Edges that started a node still at work, drawn highlighted and animated. */
  activeEdges?: ReadonlySet<string>;
  className?: string;
};

/**
 * The run's pinned graph, read-only, with each node coloured by its latest execution. Laid out
 * with ELK once the nodes are measured, and again when a node's size changes.
 */
function LaidOutRunGraph({ document, statuses, onNodeClick, activeEdges, className }: Props) {
  const flow = useMemo(() => flowOf(document), [document]);
  const colorMode = useFlowColorMode();
  const [layout, setLayout] = useState<LayoutResult>();
  const signature = useMeasuredSignature();
  const runLayout = useElkLayout();
  const { fitView, fitBounds, getNodesBounds } = useReactFlow();

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

  const targets = useMemo(() => followTargets(statuses), [statuses]);
  // fitBounds moves at once; fitView with nodes waits for the next node update, a step behind the run.
  const fitTargets = useCallback((ids: string[]) => void fitBounds(getNodesBounds(ids), { duration: 400, padding: 0.6 }), [fitBounds, getNodesBounds]);
  const follow = useFollow(targets, fitTargets);

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
  const edges = useMemo(
    () => flow.edges.map((e) => (activeEdges?.has(e.id) ? { ...e, animated: true, zIndex: 1, data: { ...e.data!, active: true } } : e)),
    [flow.edges, activeEdges],
  );
  return (
    <EdgeRoutesContext.Provider value={layout?.routes ?? NO_ROUTES}>
      <div className={cn("h-80 overflow-hidden rounded-md border transition-opacity", layout ? "opacity-100" : "opacity-0", className)}>
        <ReactFlow
          colorMode={colorMode}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.15}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={onNodeClick ? (_, node) => onNodeClick(node.id) : undefined}
          onMoveStart={follow.onMoveStart}
          proOptions={{ hideAttribution: false }}
        >
          <Background />
          <Controls showInteractive={false}>
            {/* Keeps the running or waiting nodes in view; moving the view yourself turns it off. */}
            <ControlButton
              onClick={follow.toggle}
              aria-label="Follow the active node"
              aria-pressed={follow.following}
              title={follow.following ? "Following the active node; move the view to stop" : "Follow the active node"}
              className={cn("[&_svg]:!fill-none", follow.following && "!bg-primary !text-primary-foreground")}
            >
              <LocateFixedIcon />
            </ControlButton>
          </Controls>
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
