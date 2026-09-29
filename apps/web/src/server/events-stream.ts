import { eq, listEventsAfter, runs, type DbExecutor } from "@handoff/db";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const encoder = new TextEncoder();

export type StreamedEvent = { seq: number; type: string; payload: unknown; nodeExecutionId: string | null; createdAt: string };

/**
 * Server-Sent Events for one run. Resumes after Last-Event-ID (or ?after=), polls the events table,
 * pings to keep proxies open, and ends with an `end` event once a finished run is drained.
 */
export function eventsResponse(
  db: DbExecutor,
  runId: string,
  request: Request,
  opts: { pollMs?: number; pingMs?: number; batch?: number } = {},
): Response {
  const pollMs = opts.pollMs ?? 750;
  const pingMs = opts.pingMs ?? 15_000;
  const batch = opts.batch ?? 500;
  const url = new URL(request.url);
  let cursor = Number(request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      request.signal.addEventListener("abort", close, { once: true });
      let lastSend = Date.now();
      while (!closed) {
        const rows = await listEventsAfter(db, runId, cursor, batch);
        for (const row of rows) {
          const data: StreamedEvent = {
            seq: row.seq,
            type: row.type,
            payload: row.payload,
            nodeExecutionId: row.nodeExecutionId,
            createdAt: row.createdAt.toISOString(),
          };
          send(`id: ${row.seq}\ndata: ${JSON.stringify(data)}\n\n`);
          cursor = row.seq;
          lastSend = Date.now();
        }
        if (rows.length === batch) continue;
        const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
        if (!run || TERMINAL.has(run.status)) {
          const more = await listEventsAfter(db, runId, cursor, 1);
          if (more.length === 0) {
            send(`event: end\ndata: ${JSON.stringify({ status: run?.status ?? "missing" })}\n\n`);
            close();
            break;
          }
          continue;
        }
        if (Date.now() - lastSend >= pingMs) {
          send(": ping\n\n");
          lastSend = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
