"use client";

import {
  ArrowRightIcon,
  CircleAlertIcon,
  CircleXIcon,
  HandIcon,
  HourglassIcon,
  PauseIcon,
  PlayIcon,
  PowerIcon,
  SkipForwardIcon,
  SlidersHorizontalIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { SchedulerEventView } from "@/server/scheduler-card";

/** Each event's icon and colour; a pause the scheduler made itself reads as a failure. */
function iconOf(e: SchedulerEventView): { icon: LucideIcon; tone: string } {
  switch (e.type) {
    case "scheduler.started":
    case "scheduler.resumed":
    case "scheduler.run_started":
      return { icon: PlayIcon, tone: "text-active" };
    case "scheduler.changed":
      return { icon: SlidersHorizontalIcon, tone: "text-muted-foreground" };
    case "scheduler.paused":
      return e.text.startsWith("Paused itself") ? { icon: CircleAlertIcon, tone: "text-danger" } : { icon: PauseIcon, tone: "text-muted-foreground" };
    case "scheduler.stopped":
      return { icon: PowerIcon, tone: "text-muted-foreground" };
    case "scheduler.held":
      return { icon: HandIcon, tone: "text-attention" };
    case "scheduler.idle":
      return { icon: HourglassIcon, tone: "text-muted-foreground" };
    case "scheduler.skipped":
      return { icon: SkipForwardIcon, tone: "text-muted-foreground" };
    case "scheduler.start_failed":
      return { icon: CircleXIcon, tone: "text-danger" };
    case "scheduler.released":
      return { icon: Undo2Icon, tone: "text-muted-foreground" };
    default:
      return { icon: ArrowRightIcon, tone: "text-muted-foreground" };
  }
}

const day = (at: Date) => at.toISOString().slice(0, 10);

/** "Today", "Yesterday", or "Sep 30", in UTC like the times. */
function dayLabel(at: Date, now: Date) {
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (day(at) === day(now)) return "Today";
  if (day(at) === day(yesterday)) return "Yesterday";
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The events by day, newest first. */
function groups(events: SchedulerEventView[], now: Date) {
  const result: { label: string; events: SchedulerEventView[] }[] = [];
  for (const e of events) {
    const label = dayLabel(e.at, now);
    const last = result.at(-1);
    if (last?.label === label) last.events.push(e);
    else result.push({ label, events: [e] });
  }
  return result;
}

/** All events: a sheet with the last 50 scheduler events, newest first, grouped by day, each as a sentence. */
export function SchedulerEvents({ project, events, now = new Date() }: { project: { name: string }; events: SchedulerEventView[]; now?: Date }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="xs" variant="ghost" className="text-muted-foreground">
          All events
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Scheduler events</SheetTitle>
          <SheetDescription>{project.name}, the last 50, newest first.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          {events.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing yet.</p>}
          {groups(events, now).map((g) => (
            <section key={g.label} className="flex flex-col gap-2">
              <h3 className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">{g.label}</h3>
              <ul aria-label={g.label} className="flex flex-col gap-2.5">
                {g.events.map((e) => {
                  const { icon: Icon, tone } = iconOf(e);
                  return (
                    <li key={e.id} className="grid grid-cols-[2.75rem_1rem_minmax(0,1fr)] items-start gap-2 text-[13px] leading-snug">
                      <time dateTime={e.at.toISOString()} className="pt-px font-mono text-xs text-muted-foreground">
                        {e.at.toISOString().slice(11, 16)}
                      </time>
                      <Icon aria-hidden className={cn("mt-0.5 size-3.5", tone)} />
                      <span className="break-words">{e.text}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
