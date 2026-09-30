"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { CUSTOM_HANDLE, portsOf, type FlowNodeData, type NodeType } from "@handoff/core";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/runs/status-badge";
import { cn } from "@/lib/utils";
import { NODE_ICONS } from "./node-icons";

export type HandoffNodeData = FlowNodeData & { status?: string; attempts?: number; invalid?: boolean };
export type HandoffNode = Node<HandoffNodeData, "handoff">;

const statusRing: Record<string, string> = {
  running: "ring-2 ring-sky-500/60",
  waiting: "ring-2 ring-amber-500/60",
  failed: "ring-2 ring-destructive/70",
  passed: "border-emerald-500/50",
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
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{data.label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="truncate font-mono text-[10px] text-muted-foreground">{id}</span>
        {data.isStart && <Badge variant="secondary">start</Badge>}
        {library > 0 && <Badge variant="outline">{library} library</Badge>}
        {data.status && <StatusBadge status={data.status} label={data.attempts && data.attempts > 1 ? `${data.status} ×${data.attempts}` : data.status} />}
      </div>
      <Ports data={data} />
    </div>
  );
}

/**
 * The node's inputs on the left and outputs on the right, one labelled handle each. The rows reach
 * the node's border, so each handle sits on it and ELK can route to its measured position.
 */
function Ports({ data }: { data: HandoffNodeData }) {
  const { inputs, outputs } = portsOf(data.nodeType, data.config);
  const out = [...outputs.map((o) => ({ id: o.id, label: o.label, back: o.tone === "back" })), ...(data.customOut ? [{ id: CUSTOM_HANDLE, label: "custom", back: false }] : [])];
  return (
    <div className="-mx-3 grid grid-cols-2 gap-x-2 font-mono text-[10px] text-muted-foreground">
      <div className="flex flex-col gap-1">
        {inputs.map((input) => (
          <div key={input.id} className="relative pl-3">
            {input.label}
            <Handle type="target" id={input.id} position={Position.Left} />
          </div>
        ))}
      </div>
      <div className="flex flex-col items-end gap-1">
        {out.map((port) => (
          <div key={port.id} className={cn("relative pr-3", port.back && "text-destructive")}>
            {port.label}
            <Handle type="source" id={port.id} position={Position.Right} />
          </div>
        ))}
      </div>
    </div>
  );
}

export const HandoffNodeComponent = memo(HandoffNodeView);
