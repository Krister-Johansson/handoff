"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A body longer than this, or of more lines than the clamp shows, starts clamped with Show more. */
const LONG = 240;
const LINES = 3;

/** The task's body under the run's title, clamped to three lines when it is long. */
export function RunTaskBody({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const long = body.length > LONG || body.split("\n").length > LINES;
  return (
    <div className="flex max-w-3xl flex-col items-start gap-0.5">
      <p className={cn("text-[13px]/[1.5] whitespace-pre-line text-muted-foreground", long && !open && "line-clamp-3")}>{body}</p>
      {long && (
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}
