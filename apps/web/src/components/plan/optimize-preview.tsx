"use client";

import { WandSparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { previewSentence } from "@/lib/plan/flow-text";

/**
 * Optimize's preview above the Flow (docs/plans/flow.md, Decision 11): what it will move and the pins it keeps,
 * the rule it follows, and Apply and Cancel. The Flow under it shows the moving cards dashed at their new places
 * with their old places outlined. Nothing is written before Apply.
 */
export function OptimizePreview({
  moved,
  kept,
  scope,
  selected,
  onApply,
  onCancel,
}: {
  moved: number;
  kept: number;
  /** What the selection is called, such as "epic #12 Project management" or "the plan". */
  scope: string;
  /** Whether the person ticked items, so the rest keeps its place. */
  selected: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="status"
      aria-label="Optimize preview"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-active-dot/40 bg-active-bg px-3.5 py-2.5 text-[13px] [&_svg]:size-4"
    >
      <WandSparklesIcon aria-hidden className="shrink-0 text-active" />
      <div className="min-w-0 flex-1 basis-80">
        <p className="font-medium">{previewSentence(moved, kept, scope)}</p>
        <p className="text-xs text-muted-foreground">
          Blockers first, then the tasks that unblock the most work or sit on the longest chain, then priority, then size.{" "}
          {selected ? "Everything outside the selection keeps its place." : "Pinned tasks keep their places."}
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onApply} disabled={moved === 0}>
          Apply
        </Button>
      </div>
    </div>
  );
}
