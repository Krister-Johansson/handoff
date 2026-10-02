"use client";

import { ControlButton } from "@xyflow/react";
import { HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type VersionItem = { version: number; createdAt: string; createdBy: string | null };

type Props = {
  versions: VersionItem[];
  /** The version the canvas is based on; it is marked current and cannot be restored. */
  version: number;
  /** An earlier version shown on the canvas and not saved yet. */
  restoring: number | undefined;
  pending: boolean;
  onRestore: (version: number) => void;
};

/** A button for the canvas controls that opens the graph's saved versions in a drawer on the right. */
export function VersionHistory({ versions, version, restoring, pending, onRestore }: Props) {
  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <ControlButton aria-label="Version history">
              <HistoryIcon />
            </ControlButton>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">Version history</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="gap-0">
        <SheetHeader className="border-b">
          <SheetTitle>Version history</SheetTitle>
          <SheetDescription>
            {restoring === undefined ? "Restore shows an earlier version on the canvas. Save to make it the latest version." : `Showing v${restoring}. Save to make it the latest version.`}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-1 p-4 text-sm">
            {versions.map((v) => (
              <li key={v.version} className="flex items-center justify-between gap-2">
                <span className="tabular-nums">
                  <span className="font-mono text-xs">v{v.version}</span> <span className="text-xs text-muted-foreground">{v.createdAt.slice(0, 16).replace("T", " ")}</span>
                </span>
                <Button variant="ghost" size="xs" disabled={pending || v.version === version} onClick={() => onRestore(v.version)}>
                  {v.version === version ? "current" : "Restore"}
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
