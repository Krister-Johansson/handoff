"use client";

import { useEffect, useRef, useState } from "react";
import { statusFromEvent } from "@/lib/status";
import type { RunEvent } from "./event-stream";
import { ExecutionPanel } from "./execution-panel";

/**
 * One execution on its own page: it follows the run's event stream from `after`, so new activity
 * shows as it happens and the details reload when the node's status changes.
 */
export function ExecutionView({ runId, executionId, initialStatus, after = 0 }: { runId: string; executionId: string; initialStatus: string; after?: number }) {
  const [status, setStatus] = useState(initialStatus);
  const [liveCli, setLiveCli] = useState<RunEvent[]>([]);
  const lastSeq = useRef(after);
  useEffect(() => {
    const source = new EventSource(`/api/runs/${runId}/events?after=${lastSeq.current}`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as RunEvent;
      if (event.seq <= lastSeq.current || event.nodeExecutionId !== executionId) return;
      lastSeq.current = event.seq;
      if (event.type.startsWith("cli.")) setLiveCli((list) => [...list.slice(-3_000), event]);
      const next = statusFromEvent(event.type);
      if (next) setStatus(next);
    };
    source.addEventListener("end", () => source.close());
    return () => source.close();
  }, [runId, executionId]);
  return <ExecutionPanel runId={runId} executionId={executionId} status={status} liveCli={liveCli} wide />;
}
