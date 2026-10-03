import type { LiveTurn, TurnEvent } from "./relay";

const TERMINAL = new Set<TurnEvent["type"]>(["done", "interrupted", "error"]);

/**
 * A turn as server-sent events: the turn's id first, then every event it streamed so far and each new
 * one, until done, interrupted or error. A panel that goes away ends only the stream; the turn goes on
 * and its reply is stored.
 */
export function turnEventStream(turn: Pick<LiveTurn, "id" | "subscribe">): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let n = 0;
      controller.enqueue(encoder.encode(`event: turn\ndata: ${JSON.stringify({ type: "turn", turnId: turn.id })}\n\n`));
      // The turn replays what it streamed before this call, so the end may come before subscribe returns.
      const stop = turn.subscribe((event) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`id: ${n++}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        if (TERMINAL.has(event.type)) {
          closed = true;
          unsubscribe?.();
          controller.close();
        }
      });
      if (closed) stop();
      else unsubscribe = stop;
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" } });
}
