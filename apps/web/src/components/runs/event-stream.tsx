"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { summarizeEvent } from "@/lib/event-summary";

export type RunEvent = { seq: number; type: string; payload: unknown; nodeExecutionId: string | null; createdAt: string };

/** UTC HH:MM:SS straight from the ISO string, so server and client render the same text. */
const time = (iso: string) => iso.slice(11, 19);
const family = (type: string) => type.split(".")[0] ?? type;

export function EventStream({
  runId,
  initialEvents,
  onEvent,
}: {
  runId: string;
  initialEvents: RunEvent[];
  onEvent?: (event: RunEvent) => void;
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
    <ScrollArea className="h-[32rem] rounded-md border">
      <ol className="flex flex-col font-mono text-xs">
        {events.map((event) => (
          <li key={event.seq} className="flex items-baseline gap-3 border-b px-3 py-1.5 last:border-b-0">
            <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{event.seq}</span>
            <span className="w-16 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{time(event.createdAt)}</span>
            <Badge variant={family(event.type) === "cli" ? "outline" : "secondary"} className="shrink-0 font-mono">
              {event.type}
            </Badge>
            <span className="min-w-0 truncate">{summarizeEvent(event)}</span>
          </li>
        ))}
        <div ref={bottom} />
      </ol>
    </ScrollArea>
  );
}
