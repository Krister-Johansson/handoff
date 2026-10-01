import { findTurn } from "@/server/assistant/relay";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

/** The person's answer to an approval card of a running turn. */
export async function POST(request: Request, { params }: { params: Promise<{ turnId: string }> }) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const { turnId } = await params;
  const body = (await request.json().catch(() => ({}))) as { requestId?: unknown; approved?: unknown; note?: unknown };
  if (typeof body.requestId !== "string" || typeof body.approved !== "boolean") return Response.json({ error: "requestId and approved are required" }, { status: 400 });
  const turn = findTurn(turnId);
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined;
  if (!turn || !turn.answer(body.requestId, { approved: body.approved, ...(note ? { note } : {}) })) {
    return Response.json({ error: "That card is no longer open." }, { status: 410 });
  }
  return Response.json({ ok: true });
}
