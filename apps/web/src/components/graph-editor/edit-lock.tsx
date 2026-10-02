"use client";

import { ControlButton } from "@xyflow/react";
import { LockIcon, LockOpenIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The lock in the canvas controls. It stands in for React Flow's own lock, which also turns off
 * selecting; a locked graph here still lets you select a node or an edge and edit it in the inspector.
 */
export function EditLockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  const label = locked ? "Unlock editing" : "Lock editing";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ControlButton aria-label={label} onClick={onToggle}>
          {locked ? <LockIcon /> : <LockOpenIcon />}
        </ControlButton>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
