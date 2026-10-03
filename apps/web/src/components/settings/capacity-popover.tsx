"use client";

import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { setCapacityAction } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDuration } from "@/lib/plan/duration";

const MIN_HOURS = 1;
const MAX_HOURS = 24;

/** Hours as the plan writes them, never in days: "6h", "7h 30m". */
const hoursText = (hours: number) => formatDuration(hours, Infinity);

/** The typed hours a day, or undefined when they are not a number from 1 to 24. */
function typedHours(text: string): number | undefined {
  const hours = text.trim() ? Number(text) : Number.NaN;
  return Number.isFinite(hours) && hours >= MIN_HOURS && hours <= MAX_HOURS ? hours : undefined;
}

/** How a 12h manual estimate reads at the saved capacity, and at the typed one when it differs. */
function estimateNote(saved: number, typed: number | undefined): string {
  const at = (hours: number) => `${formatDuration(12, hours)} at ${hoursText(hours)} a day`;
  const also = typed !== undefined && typed !== saved ? ` and ${at(typed)}` : "";
  return `Manual estimates stay in hours. A 12h estimate reads ${at(saved)}${also}.`;
}

/**
 * The capacity popover: the person's hours of work a day on the project's plan, from 1 to 24, with what a
 * day is and how a 12h estimate reads. `children` is the button that opens it; Save writes it at once.
 */
export function CapacityPopover({ projectId, capacity, children }: { projectId: string; capacity: number; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(capacity));
  const [error, setError] = useState<string>();
  const [saving, startSaving] = useTransition();
  const hours = typedHours(text);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setText(String(capacity));
      setError(undefined);
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (hours === undefined) return;
    startSaving(async () => {
      const result = await setCapacityAction({ projectId, hours });
      if (result.ok) setOpen(false);
      else setError(result.error);
    });
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0 text-[13px]" aria-label="Capacity">
        <form onSubmit={save} className="contents">
          <div className="flex flex-col gap-0.5 p-3.5 pb-3">
            <h3 className="font-semibold">Capacity</h3>
            <p className="text-xs leading-normal text-muted-foreground">
              Hours of work a day for this project. It sets how long a bar is and how full Arrange fills a day. Every day counts, weekends too.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 border-t p-3.5 pb-3">
            <label htmlFor={`${id}-hours`} className="text-xs font-medium">
              Hours a day
            </label>
            <div className="flex items-center gap-2">
              <Input
                id={`${id}-hours`}
                type="number"
                inputMode="decimal"
                min={MIN_HOURS}
                max={MAX_HOURS}
                step={0.5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-invalid={hours === undefined}
                className="h-8 w-20"
              />
              {hours !== undefined && <span className="text-xs text-muted-foreground">1d is {hoursText(hours)}</span>}
            </div>
            {hours === undefined ? (
              <FieldError className="text-xs">Hours a day is a number from {MIN_HOURS} to {MAX_HOURS}.</FieldError>
            ) : (
              <p className="text-xs leading-normal text-muted-foreground">{estimateNote(capacity, hours)}</p>
            )}
          </div>
          {error && <FieldError className="border-t px-3.5 py-2 text-xs">{error}</FieldError>}
          <div className="flex justify-end gap-2 border-t px-3.5 py-2.5">
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || hours === undefined}>
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
