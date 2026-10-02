"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Text that folds at a height with a button to show the rest. `folds` says whether it is long enough to
 * fold; the caller decides from the text, so the page renders the same on the server and in the browser.
 */
export function Foldable({ folds, height, more, children }: { folds: boolean; height: "description" | "comment"; more: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const folded = folds && !open;
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "relative",
          folded && "overflow-hidden mask-b-from-60% mask-b-to-100%",
          folded && (height === "description" ? "max-h-[300px]" : "max-h-[240px]"),
        )}
      >
        {children}
      </div>
      {folded && (
        <Button variant="ghost" size="sm" className="self-start px-0 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={() => setOpen(true)}>
          <ChevronDownIcon data-icon="inline-start" />
          {more}
        </Button>
      )}
    </div>
  );
}
