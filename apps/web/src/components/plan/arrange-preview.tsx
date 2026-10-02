"use client";

import { CalendarRangeIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ArrangePreview } from "@/lib/plan/arrange";
import { formatDuration } from "@/lib/plan/duration";
import { shortDay } from "@/lib/plan/timeline-scale";
import { cn } from "@/lib/utils";

/**
 * Arrange by estimate on the timeline: whether the page can arrange at all (it needs sizes), whether a task in
 * Unscheduled has a duration to place, the preview while it shows with its hours per day, and its buttons.
 */
export type ArrangeControl = {
  enabled: boolean;
  possible: boolean;
  preview: ArrangePreview | undefined;
  previewHours: Record<string, number> | undefined;
  start: () => void;
  cancel: () => void;
  save: () => void;
};

const tasksText = (n: number) => (n === 1 ? "1 task" : `${n} tasks`);
const numbers = (issues: readonly number[]) => issues.map((n) => `#${n}`).join(issues.length > 2 ? ", " : " and ");

/** The days a preview covers: "Oct 3", or "Oct 3 to Oct 6". */
function rangeText(preview: ArrangePreview): string {
  const start = preview.placements.map((p) => p.start).sort()[0]!;
  const end = preview.placements.map((p) => p.target).sort().at(-1)!;
  return start === end ? shortDay(start) : `${shortDay(start)} to ${shortDay(end)}`;
}

/** The tasks Arrange could not place, in a sentence; empty when it placed them all. */
function leftOutText(preview: ArrangePreview): string {
  const issues = preview.leftOut.map((l) => l.issue);
  if (issues.length === 0) return "";
  return issues.length === 1 ? ` ${numbers(issues)} has no size and no estimate and stays unscheduled.` : ` ${numbers(issues)} have no size and no estimate and stay unscheduled.`;
}

/** The preview's banner over the chart: what it places and how, with Cancel and Save. Nothing is written before Save. */
export function ArrangeBanner({ arrange, capacity }: { arrange: ArrangeControl; capacity: number }) {
  const preview = arrange.preview;
  if (!preview) return null;
  const count = tasksText(preview.placements.length);
  return (
    <div className="p-2.5">
      <Alert role="region" aria-label="Arrange preview" className="border-active-dot/40 bg-active-bg sm:pr-72">
        <CalendarRangeIcon className="text-active" />
        <AlertTitle>
          Preview: {count}, {rangeText(preview)}
        </AlertTitle>
        <AlertDescription className="text-xs">
          From today, in blocker order, up to {formatDuration(capacity, Infinity)} a day after the work already planned. Each task uses its manual estimate, or else its size forecast.
          {leftOutText(preview)}
        </AlertDescription>
        <div className="col-start-2 mt-1.5 flex gap-2 sm:absolute sm:top-1/2 sm:right-2.5 sm:mt-0 sm:-translate-y-1/2">
          <Button size="sm" variant="outline">
            Cancel
          </Button>
          <Button size="sm">Save {count} to GitHub</Button>
        </div>
      </Alert>
    </div>
  );
}

/**
 * The Unscheduled header's Arrange by estimate: pressed while its preview shows, and off with the reason when
 * no task in Unscheduled has a size or an estimate.
 */
export function ArrangeButton({ arrange }: { arrange: ArrangeControl }) {
  if (!arrange.enabled) return null;
  const on = arrange.preview !== undefined;
  const button = (
    <Button
      size="xs"
      variant="outline"
      aria-pressed={on}
      aria-disabled={!arrange.possible || undefined}
      onClick={() => {
        if (!arrange.possible) return;
        if (on) arrange.cancel();
        else arrange.start();
      }}
      className={cn(on && "border-active-dot/50 bg-active-bg text-active", !arrange.possible && "cursor-not-allowed opacity-50")}
    >
      <CalendarRangeIcon data-icon="inline-start" />
      Arrange by estimate
    </Button>
  );
  if (arrange.possible) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>No unscheduled task here has a size or an estimate</TooltipContent>
    </Tooltip>
  );
}
