"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { FlowNodeData, NodeType } from "@handoff/core";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { NODE_ICONS } from "./node-icons";

export type HandoffNodeData = FlowNodeData & { status?: string; attempts?: number; invalid?: boolean };
export type HandoffNode = Node<HandoffNodeData, "handoff">;

const statusRing: Record<string, string> = {
  running: "ring-2 ring-primary/60",
  waiting: "ring-2 ring-amber-500/60",
  failed: "ring-2 ring-destructive/70",
};

function HandoffNodeView({ id, data, selected }: NodeProps<HandoffNode>) {
  const Icon = NODE_ICONS[data.nodeType as NodeType] ?? NODE_ICONS.function;
  const library = (data.library?.skills?.length ?? 0) + (data.library?.mcp?.length ?? 0) + (data.library?.agents?.length ?? 0);
  return (
    <div
      className={cn(
        "flex w-52 flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-sm",
        selected && "border-primary",
        data.invalid && "border-destructive",
        data.status && statusRing[data.status],
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{data.label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="truncate font-mono text-[10px] text-muted-foreground">{id}</span>
        {data.isStart && <Badge variant="secondary">start</Badge>}
        {library > 0 && <Badge variant="outline">{library} library</Badge>}
        {data.status && <Badge variant={statusTone(data.status)}>{data.attempts && data.attempts > 1 ? `${data.status} ×${data.attempts}` : data.status}</Badge>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const HandoffNodeComponent = memo(HandoffNodeView);
