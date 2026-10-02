"use client";

import { useState, type KeyboardEvent } from "react";
import { ListChecksIcon } from "lucide-react";
import type { PlanSize } from "@handoff/github";
import type { PlanTask } from "@/server/plan";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { formatDuration, parseEstimate } from "@/lib/plan/duration";
import { endDayOf } from "@/lib/plan/schedule";
import { forecastSentence, hoursInWords, overridden, SIZES, usually, type SizeChange } from "@/lib/plan/size-text";
import { shortDay } from "@/lib/plan/timeline-scale";
import { cn } from "@/lib/utils";
import type { SizingControl } from "./plan-context";

/** The manual estimates one press away. */
const PICKS = ["1h", "2h", "3h", "4h", "1d", "2d"] as const;

/** A task's Size and estimate as the popover shows them: the person's last pick while it saves. */
export type SizeValue = { size: PlanSize | undefined; estimate: number | undefined };

/** Where a task's Target moves with a new duration: only a task with a Start has one that follows. */
function targetNote(task: PlanTask, hours: number, sizing: SizingControl): string {
  if (!task.start) return "";
  const span = sizing.spanOf(task.number);
  // A sized bar starts after the hours of the tasks before it on its first day; a dated one at the start of the day.
  const offset = span?.hours !== undefined ? (span.offsetHours ?? 0) : 0;
  const end = endDayOf(task.start, offset, hours, sizing.capacity);
  return end === task.target ? ` Target stays ${shortDay(end)}.` : ` Target moves to ${shortDay(end)}.`;
}

/** What a typed estimate means: its hours, what it overrides and where the Target goes; or the hint for a typo. */
function typedNote(text: string, task: PlanTask, value: SizeValue, sizing: SizingControl): { hours: number; note: string } | { error: string } | undefined {
  if (!text.trim()) return undefined;
  const parsed = parseEstimate(text, sizing.capacity);
  if ("error" in parsed) return parsed;
  if (parsed.hours === 0) return { hours: 0, note: "0 clears the manual estimate; the forecast applies." };
  const size = value.size ?? task.proposal?.size;
  const overrides = size ? ` Overrides ${overridden(sizing.forecasts[size], sizing.capacity)}.` : "";
  return { hours: parsed.hours, note: `${hoursInWords(parsed.hours)}.${overrides}${targetNote(task, parsed.hours, sizing)}` };
}

/**
 * The size popover of a task: S, M and L with this project's forecasts, the planner's proposal with Use,
 * then an optional manual estimate in hours or days with quick picks, and Use the forecast to clear it.
 * Picking a size or a quick pick saves at once; Enter saves a typed estimate.
 */
export function SizePopover({
  task,
  value,
  sizing,
  error,
  onSave,
}: {
  task: PlanTask;
  value: SizeValue;
  sizing: SizingControl;
  /** Why the last save failed, as GitHub or handoff said it. */
  error: string | undefined;
  onSave: (change: SizeChange) => void;
}) {
  const [text, setText] = useState("");
  const { forecasts, capacity } = sizing;
  const proposal = !value.size ? task.proposal : undefined;
  const shown = value.size ?? proposal?.size;
  const typed = typedNote(text, task, value, sizing);
  const pickSize = (size: PlanSize) => size !== value.size && onSave({ size });
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !typed || "error" in typed) return;
    e.preventDefault();
    onSave({ estimate: typed.hours === 0 ? null : typed.hours });
  };

  return (
    <PopoverContent align="end" className="w-75 gap-0 p-0 text-[13px]" aria-label={`Size and estimate of #${task.number}`}>
      <div className="flex flex-col gap-2 p-3.5 pb-3">
        <h3 className="font-semibold">Size</h3>
        <div role="group" aria-label="Size" className="grid grid-cols-3 gap-1">
          {SIZES.map((size) => {
            const forecast = forecasts[size];
            const picked = value.size === size;
            return (
              <button
                key={size}
                type="button"
                aria-pressed={picked}
                title={proposal?.size === size ? "Proposed by the planner" : undefined}
                onClick={() => pickSize(size)}
                className={cn(
                  "flex flex-col items-center gap-px rounded-md border border-input bg-card px-1 py-1.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  picked && "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
                  proposal?.size === size && "border-dashed border-foreground/60 bg-muted",
                )}
              >
                <b className="font-mono text-[13px] font-semibold">{size}</b>
                <span className={cn("text-[11px] text-muted-foreground", picked && "text-primary-foreground/70")}>
                  ~{usually(forecast, capacity)}
                  {forecast.source === "default" && " default"}
                </span>
              </button>
            );
          })}
        </div>
        {shown && <p className="text-xs leading-normal text-muted-foreground">{forecastSentence(forecasts[shown], capacity, sizing.projectName)}</p>}
        {proposal && (
          <div className="flex items-start gap-1.5 rounded-md border border-dashed border-input p-2 text-xs leading-snug text-foreground/80">
            <ListChecksIcon aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />
            <span>
              The planner proposed {proposal.size} from its plan: {proposal.steps} steps, {proposal.paths} owned paths.
            </span>
            <Button size="xs" variant="outline" className="ml-auto shrink-0" onClick={() => onSave({ size: proposal.size })}>
              Use {proposal.size}
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t p-3.5 pb-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-semibold">
            Manual estimate <span className="ml-1 text-xs font-medium text-muted-foreground">optional</span>
          </h3>
          <p className="text-xs leading-normal text-muted-foreground">Overrides the forecast. Saved in hours to the Estimate field.</p>
        </div>
        <div role="group" aria-label="Estimate quick picks" className="grid grid-cols-6 gap-1">
          {PICKS.map((pick) => {
            const hours = (parseEstimate(pick, capacity) as { hours: number }).hours;
            const picked = value.estimate === hours;
            return (
              <Button key={pick} size="xs" variant={picked ? "default" : "outline"} aria-pressed={picked} onClick={() => !picked && onSave({ estimate: hours })}>
                {pick}
              </Button>
            );
          })}
        </div>
        <Input
          aria-label="Manual estimate"
          placeholder="5h or 1.5d"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-invalid={typed !== undefined && "error" in typed}
          className="h-8 bg-muted/40"
        />
        {typed && ("error" in typed ? <FieldError className="text-xs">{typed.error}</FieldError> : <p className="text-xs leading-normal text-muted-foreground">{typed.note}</p>)}
        {!typed && value.estimate !== undefined && (
          <p className="text-xs text-muted-foreground">Now {formatDuration(value.estimate, capacity)}, {hoursInWords(value.estimate)}.</p>
        )}
      </div>
      {error && <FieldError className="border-t px-3.5 py-2 text-xs">{error}</FieldError>}
      <div className="flex items-center justify-between border-t px-3.5 py-2 text-xs text-muted-foreground">
        <Button variant="link" size="xs" className="h-auto px-0 text-foreground/80" disabled={value.estimate === undefined} onClick={() => onSave({ estimate: null })}>
          Use the forecast
        </Button>
        <span>Enter saves</span>
      </div>
    </PopoverContent>
  );
}
