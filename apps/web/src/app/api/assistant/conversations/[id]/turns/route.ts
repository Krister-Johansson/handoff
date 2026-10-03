import { PageDescriptorSchema } from "@/lib/assistant/page-tools";
import { TurnRunningError } from "@/server/assistant/relay";
import { liveTurnDeps, unavailableMessage } from "@/server/assistant/live";
import { turnEventStream } from "@/server/assistant/sse";
import { startTurn } from "@/server/assistant/turn";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

/**
 * Starts a turn of a conversation and streams it as server-sent events: text deltas, tool calls and
 * results, approval cards, then done, interrupted or error. Refused while the conversation answers. The
 * body's `page` names the page the person asked on; the turn offers the tools it bound.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const deps = liveTurnDeps(request);
  if (!deps) return Response.json({ error: unavailableMessage() ?? "The assistant is unavailable." }, { status: 503 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; source?: unknown; page?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "Say something first." }, { status: 400 });
  // The page the person asked on: a page the server does not know is dropped, and the turn starts without it.
  const page = PageDescriptorSchema.safeParse(body.page);
  let turn;
  try {
    turn = await startTurn(deps, id, { text, source: typeof body.source === "string" ? body.source : "typed", ...(page.success ? { page: page.data } : {}) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: error instanceof TurnRunningError ? 409 : 400 });
  }
  return turnEventStream(turn);
}
