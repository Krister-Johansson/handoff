"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import type { EdgeAttributes } from "@handoff/core";
import { describeCondition } from "@/lib/condition-text";
import { cn } from "@/lib/utils";
import { edgeStyle, loopPath } from "./edge-geometry";

export type HandoffEdge = Edge<EdgeAttributes & { taken?: boolean }, "handoff">;

function HandoffEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd }: EdgeProps<HandoffEdge>) {
  const [path, labelX, labelY] = data?.loop ? loopPath(sourceX, sourceY, targetX, targetY) : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const condition = describeCondition(data?.condition);
  const loop = data?.loop ? `loop ×${data.maxAttempts ?? "?"}` : "";
  const on = data?.on && data.on !== "passed" ? `on ${data.on}` : "";
  const label = [on, condition, loop].filter(Boolean).join(" · ");
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={edgeStyle(data, selected)} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "nodrag nopan pointer-events-auto absolute max-w-56 truncate rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground",
              selected && "border-primary text-foreground",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const HandoffEdgeComponent = memo(HandoffEdgeView);
