"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { summarizeEvent } from "@/lib/event-summary";
import { cn } from "@/lib/utils";

export type RunEvent = { seq: number; type: string; payload: unknown; nodeExecutionId: string | null; createdAt: string };

/** UTC HH:MM:SS straight from the ISO string, so server and client render the same text. */
const time = (iso: string) => iso.slice(11, 19);
const family = (type: string) => type.split(".")[0] ?? type;

/** Which events to show: Claude CLI events only on request, and optionally only some executions' events. */
export type EventFilter = { showCli: boolean; executionIds?: Set<string> | undefined };

const visible = (event: RunEvent, filter: EventFilter | undefined) => {
  if (!filter) return true;
  if (!filter.showCli && family(event.type) === "cli") return false;
  return !filter.executionIds || (event.nodeExecutionId !== null && filter.executionIds.has(event.nodeExecutionId));
};

export function EventStream({
  runId,
  initialEvents,
  onEvent,
  filter,
  className,
}: {
  runId: string;
  initialEvents: RunEvent[];
  onEvent?: (event: RunEvent) => void;
  filter?: EventFilter;
  className?: string;
}) {
  const [events, setEvents] = useState(initialEvents);
  const lastSeq = useRef(initialEvents.at(-1)?.seq ?? 0);
  const onEventRef = useRef(onEvent);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const source = new EventSource(`/api/runs/${runId}/events?after=${lastSeq.current}`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as RunEvent;
      if (event.seq <= lastSeq.current) return;
      lastSeq.current = event.seq;
      setEvents((current) => [...current, event]);
      onEventRef.current?.(event);
    };
    source.addEventListener("end", () => source.close());
    return () => source.close();
  }, [runId]);

  // Follow new events inside the list only, and only while the reader is already at the bottom.
  useEffect(() => {
    const viewport = bottom.current?.closest<HTMLElement>("[data-slot=scroll-area-viewport]");
    if (!viewport) return;
    const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;
    if (nearBottom || events.length === initialEvents.length) viewport.scrollTop = viewport.scrollHeight;
  }, [events.length, initialEvents.length]);

  return (
    <ScrollArea className={cn("h-[32rem]", className)}>
      <ol className="flex flex-col font-mono text-xs">
        {events
          .filter((event) => visible(event, filter))
          .map((event) => (
            <li
              key={event.seq}
              className="grid grid-cols-[28px_60px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 border-t px-3.5 py-1.5 first:border-t-0 sm:grid-cols-[36px_64px_150px_minmax(0,1fr)]"
            >
              <span className="text-right text-muted-foreground/70 tabular-nums">{event.seq}</span>
              <span className="whitespace-nowrap text-muted-foreground tabular-nums">{time(event.createdAt)}</span>
              <span
                className={cn(
                  "inline-flex h-[18px] w-fit max-w-full items-center truncate rounded px-1.5 text-[11px]",
                  family(event.type) === "cli" ? "border text-muted-foreground" : "bg-secondary text-secondary-foreground",
                )}
              >
                {event.type}
              </span>
              <span className="col-span-full min-w-0 truncate sm:col-span-1">{summarizeEvent(event)}</span>
            </li>
          ))}
        <div ref={bottom} />
      </ol>
    </ScrollArea>
  );
}
