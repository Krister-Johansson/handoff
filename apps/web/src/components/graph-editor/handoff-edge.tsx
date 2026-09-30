"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import type { EdgeAttributes } from "@handoff/core";
import { cn } from "@/lib/utils";
import { loops, edgeLabel, edgeStyle, loopPath, roundedPath, routeFor } from "./edge-geometry";
import { useEdgeInvalid } from "./edge-issues";
import { useEdgeRoute } from "./elk-routes";

export type HandoffEdge = Edge<EdgeAttributes & { taken?: boolean; active?: boolean }, "handoff">;

function HandoffEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd }: EdgeProps<HandoffEdge>) {
  const route = useEdgeRoute(id);
  const invalid = useEdgeInvalid(id);
  const points = routeFor(route, { sourceX, sourceY, targetX, targetY });
  let path: string;
  let label: { x: number; y: number; width?: number };
  if (points) {
    path = roundedPath(points);
    const box = route?.label;
    const mid = points[Math.floor(points.length / 2)]!;
    label = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width } : mid;
  } else {
    const [fallback, x, y] = loops(data) ? loopPath(sourceX, sourceY, targetX, targetY) : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
    path = fallback;
    label = { x, y };
  }
  const text = edgeLabel(data);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={edgeStyle(data, selected, invalid, data?.active)} />
      {text && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "nodrag nopan pointer-events-auto absolute truncate rounded border bg-background px-1.5 py-0.5 text-center font-mono text-[10px] text-muted-foreground",
              label.width === undefined && "max-w-56",
              (selected || data?.active) && "border-primary text-foreground",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, ...(label.width ? { width: label.width } : {}) }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const HandoffEdgeComponent = memo(HandoffEdgeView);
