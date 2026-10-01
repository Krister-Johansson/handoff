"use client";

import { Handle, Position, useConnection, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { CUSTOM_HANDLE, portsOf, type FlowNodeData, type NodeType } from "@handoff/core";
import { StatusBadge } from "@/components/runs/status-badge";
import { canConnect, type HandleEnd } from "@/lib/connect-rules";
import { statusTone, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { NODE_ICONS } from "./node-icons";

export type HandoffNodeData = FlowNodeData & { status?: string; attempts?: number; invalid?: boolean; issues?: string[] };
export type HandoffNode = Node<HandoffNodeData, "handoff">;

/** A node in a run takes its status's tone: a ring while it works or waits or after it failed, a green border once it passed. */
const toneFrame: Partial<Record<StatusTone, string>> = {
  active: "ring-2 ring-active-dot/55",
  attention: "ring-2 ring-attention-dot/55",
  danger: "ring-2 ring-danger-dot/55",
  success: "border-success-dot/55",
  repaired: "border-repaired-dot/55",
};

/** Start and Finish only open and close the graph, so they draw narrower. */
const ENDS = new Set<string>(["start", "finish"]);

const TAG = "inline-flex h-4 items-center rounded-[5px] border px-1.5 font-sans text-[10px] font-medium whitespace-nowrap";

function HandoffNodeView({ id, data, selected }: NodeProps<HandoffNode>) {
  const Icon = NODE_ICONS[data.nodeType as NodeType] ?? NODE_ICONS.function;
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-[9px] border border-input bg-card px-[11px] pt-[9px] pb-2 text-card-foreground shadow-xs",
        ENDS.has(data.nodeType) ? "w-[120px]" : "w-[196px]",
        selected && "border-foreground",
        data.invalid && "border-destructive ring-2 ring-destructive/20",
        data.status && toneFrame[statusTone(data.status)],
      )}
    >
      <div className="flex items-center gap-[7px]">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px] font-medium">{data.label}</span>
      </div>
      <NodeBadges id={id} data={data} />
      <Ports id={id} data={data} />
    </div>
  );
}

/** The node's key and tags: start, library, issues and, in a run, its status. */
function NodeBadges({ id, data }: { id: string; data: HandoffNodeData }) {
  const library = (data.library?.skills?.length ?? 0) + (data.library?.mcp?.length ?? 0) + (data.library?.agents?.length ?? 0);
  const issues = data.issues ?? [];
  const status = data.status;
  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground [&>[data-tone]]:h-[18px] [&>[data-tone]]:px-1.5 [&>[data-tone]]:text-[10px]">
      <span className="truncate">{id}</span>
      {data.isStart && data.nodeType !== "start" && <span className={cn(TAG, "border-transparent bg-secondary text-secondary-foreground")}>start</span>}
      {library > 0 && <span className={TAG}>{library} library</span>}
      {issues.length > 0 && (
        <span className={cn(TAG, "border-transparent bg-danger-bg text-danger")} title={issues.join("\n")}>
          {issues.length === 1 ? "issue" : `${issues.length} issues`}
        </span>
      )}
      {status && <StatusBadge status={status} label={`${status.replaceAll("_", " ")}${data.attempts && data.attempts > 1 ? ` ×${data.attempts}` : ""}`} />}
    </div>
  );
}

/**
 * The node's inputs on the left and outputs on the right, one labelled handle each. The rows reach
 * the node's border, so each handle sits on it and ELK can route to its measured position.
 */
function Ports({ id, data }: { id: string; data: HandoffNodeData }) {
  const { inputs, outputs } = portsOf(data.nodeType, data.config);
  const out = [...outputs.map((o) => ({ id: o.id, label: o.label, back: o.kind === "feedback" })), ...(data.customOut ? [{ id: CUSTOM_HANDLE, label: "custom", back: false }] : [])];
  // While an edge is being dragged, each handle says whether it can take it.
  const from = useConnection((c): HandleEnd | null => (c.inProgress ? { node: c.fromNode.id, type: c.fromHandle.type } : null));
  const tone = (type: "source" | "target") => (from === null ? undefined : canConnect(from, { node: id, type }) ? "can" : "cannot");
  return (
    <div className="-mx-[11px] mt-0.5 flex justify-between gap-2 font-mono text-[10px] text-muted-foreground">
      <div className="flex flex-col gap-0.5">
        {inputs.map((input) => (
          <PortRow key={input.id} label={input.label} tone={tone("target")}>
            <Handle type="target" id={input.id} position={Position.Left} isConnectableEnd={tone("target") !== "cannot"} className={handleClass(tone("target"))} />
          </PortRow>
        ))}
      </div>
      <div className="flex flex-col items-end gap-0.5">
        {out.map((port) => (
          <PortRow key={port.id} label={port.label} tone={tone("source")} back={port.back} side="right">
            <Handle type="source" id={port.id} position={Position.Right} isConnectableEnd={tone("source") !== "cannot"} className={handleClass(tone("source"))} />
          </PortRow>
        ))}
      </div>
    </div>
  );
}

/** A port is a small dot on the node's border, ringed in the card colour; while dragging, a port that can take the edge grows. */
const handleClass = (tone: "can" | "cannot" | undefined) =>
  cn(
    "!size-[7px] !min-h-0 !min-w-0 !border-[1.5px] !border-card !bg-muted-foreground",
    tone === "can" && "!size-3 !bg-primary ring-2 ring-primary/30",
    tone === "cannot" && "opacity-30",
  );

function PortRow({ label, tone, back, side = "left", children }: { label: string; tone: "can" | "cannot" | undefined; back?: boolean; side?: "left" | "right"; children: React.ReactNode }) {
  return (
    <div className={cn("relative", side === "left" ? "pl-[11px]" : "pr-[11px] text-right", back && "text-danger", tone === "cannot" && "opacity-30", tone === "can" && "font-medium text-foreground")}>
      {label}
      {children}
    </div>
  );
}

export const HandoffNodeComponent = memo(HandoffNodeView);
