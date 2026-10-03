import { join } from "node:path";
import { getDb } from "@/lib/db";
import {
  ChatAnsweringError,
  conversationMessages,
  deleteConversation,
  getChat,
  renameConversation,
  setConversationPinned,
} from "@/server/assistant/conversations";
import { assistantConfig } from "@/server/assistant/env";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const forbidden = () => Response.json({ error: "forbidden" }, { status: 403 });
const notFound = () => Response.json({ error: "There is no such chat." }, { status: 404 });
const local = (request: Request) => isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"));

/** A chat with its project, its state and running turn, and its messages. */
export async function GET(request: Request, { params }: Params) {
  if (!local(request)) return forbidden();
  const { id } = await params;
  const conversation = await getChat(getDb(), id).catch(() => undefined);
  if (!conversation) return notFound();
  return Response.json({ conversation, messages: await conversationMessages(getDb(), id) });
}

/** Renames a chat (`title`), or pins or unpins it (`pinned`). */
export async function PATCH(request: Request, { params }: Params) {
  if (!local(request)) return forbidden();
  const { id } = await params;
  const body = (await request.json().catch(() => undefined)) as { title?: unknown; pinned?: unknown } | undefined;
  const title = body && typeof body === "object" ? body.title : undefined;
  const pinned = body && typeof body === "object" ? body.pinned : undefined;
  if ((title === undefined && pinned === undefined) || (title !== undefined && typeof title !== "string") || (pinned !== undefined && typeof pinned !== "boolean")) {
    return Response.json({ error: "Send a title to rename the chat, or pinned to pin or unpin it." }, { status: 400 });
  }
  try {
    if (typeof title === "string" && !(await renameConversation(getDb(), id, title))) return notFound();
    if (typeof pinned === "boolean" && !(await setConversationPinned(getDb(), id, pinned))) return notFound();
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  return Response.json({ ok: true });
}

/** Deletes a chat with its messages and its Claude Code transcript. Refused while the chat answers. */
export async function DELETE(request: Request, { params }: Params) {
  if (!local(request)) return forbidden();
  const { id } = await params;
  try {
    const deleted = await deleteConversation(getDb(), id, { configDir: join(assistantConfig().home, "claude-config") });
    return deleted ? Response.json({ ok: true }) : notFound();
  } catch (error) {
    if (error instanceof ChatAnsweringError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
