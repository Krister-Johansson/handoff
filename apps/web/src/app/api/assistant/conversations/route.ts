import { getDb } from "@/lib/db";
import { createConversation, listConversations } from "@/server/assistant/conversations";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

const forbidden = () => Response.json({ error: "forbidden" }, { status: 403 });

/** The assistant's conversations, the most recently used first. */
export async function GET(request: Request) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return forbidden();
  return Response.json(await listConversations(getDb()));
}

/** Starts a conversation, titled after its first message. */
export async function POST(request: Request) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return forbidden();
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const conversation = await createConversation(getDb(), typeof body.text === "string" ? body.text : "");
  return Response.json(conversation);
}
