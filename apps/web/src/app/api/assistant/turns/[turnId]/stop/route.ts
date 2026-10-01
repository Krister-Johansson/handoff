import { findTurn } from "@/server/assistant/relay";
import { stopTurn } from "@/server/assistant/turn";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

/** Stops a running turn: its open approval cards are denied and the reply is stored as interrupted. */
export async function POST(request: Request, { params }: { params: Promise<{ turnId: string }> }) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const { turnId } = await params;
  const turn = findTurn(turnId);
  if (turn) stopTurn(turn);
  return Response.json({ ok: true, stopped: Boolean(turn) });
}
