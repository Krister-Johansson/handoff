"use client";

import type { ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The Legend button at the right end of the Plan toolbar, opening a view's legend in a popover. */
export function LegendPopover({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Legend">
              <InfoIcon />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Legend</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className={cn("gap-2.5 text-xs", className)} aria-label="Legend">
        <PopoverHeader>
          <PopoverTitle className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Legend</PopoverTitle>
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  );
}
