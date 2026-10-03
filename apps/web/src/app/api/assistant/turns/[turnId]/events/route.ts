import { findTurn } from "@/server/assistant/relay";
import { turnEventStream } from "@/server/assistant/sse";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

/**
 * Follows a running turn again: every event it streamed so far, then each new one, as the turn's own
 * stream sends them. The panel uses it to pick up a chat that answers after a reload or a switch.
 */
export async function GET(request: Request, { params }: { params: Promise<{ turnId: string }> }) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const { turnId } = await params;
  const turn = findTurn(turnId);
  if (!turn) return Response.json({ error: "This turn has ended." }, { status: 404 });
  return turnEventStream(turn);
}
