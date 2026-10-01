import { getDb } from "@/lib/db";
import { conversationMessages, getConversation } from "@/server/assistant/conversations";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

/** A conversation and its messages. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const conversation = await getConversation(getDb(), id).catch(() => undefined);
  if (!conversation) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ conversation, messages: await conversationMessages(getDb(), id) });
}
