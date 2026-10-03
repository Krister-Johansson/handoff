"use client";

import { useEffect, useEffectEvent } from "react";
import type { RunEvent } from "@/components/runs/event-stream";

/**
 * Follows a run's events after `after`, handing each new one to `onEvent`, while `enabled`. The stream
 * ends on its own once a finished run has no more events.
 */
export function useRunEvents(runId: string, after: number, onEvent: (event: RunEvent) => void, enabled = true) {
  const handle = useEffectEvent(onEvent);
  useEffect(() => {
    if (!enabled) return;
    let last = after;
    const source = new EventSource(`/api/runs/${runId}/events?after=${after}`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as RunEvent;
      if (event.seq <= last) return;
      last = event.seq;
      handle(event);
    };
    source.addEventListener("end", () => source.close());
    return () => source.close();
  }, [runId, after, enabled]);
}
