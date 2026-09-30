"use client";

import { Background, Controls, ReactFlow, ReactFlowProvider, type EdgeTypes, type NodeTypes } from "@xyflow/react";
import { useMemo } from "react";
import { toReactFlow } from "@handoff/core";
import { HandoffEdgeComponent } from "./handoff-edge";
import { HandoffNodeComponent } from "./handoff-node";

const nodeTypes: NodeTypes = { handoff: HandoffNodeComponent };
const edgeTypes: EdgeTypes = { handoff: HandoffEdgeComponent };

export type NodeStatus = { status: string; attempts: number };

/** The run's pinned graph, read-only, with each node coloured by its latest execution. */
export function RunGraph({
  document,
  statuses,
  onNodeClick,
}: {
  document: unknown;
  statuses: Record<string, NodeStatus>;
  onNodeClick?: (nodeKey: string) => void;
}) {
  const flow = useMemo(() => toReactFlow(document), [document]);
  const nodes = useMemo(
    () => flow.nodes.map((n) => ({ ...n, data: { ...n.data, ...(statuses[n.id] ?? {}) }, draggable: false, connectable: false })),
    [flow.nodes, statuses],
  );
  return (
    <ReactFlowProvider>
      <div className="h-80 rounded-md border">
        <ReactFlow nodes={nodes} edges={flow.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView minZoom={0.15} nodesConnectable={false} elementsSelectable={false} onNodeClick={onNodeClick ? (_, node) => onNodeClick(node.id) : undefined} proOptions={{ hideAttribution: false }}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
