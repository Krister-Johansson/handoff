import { getDb } from "@/lib/db";
import { createConversation, getChat, listChats, type ChatListOptions } from "@/server/assistant/conversations";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

const forbidden = () => Response.json({ error: "forbidden" }, { status: 403 });

/**
 * The assistant's chats: every pinned one, then up to `limit` others by last use, with their project,
 * last message and state, and how many match in all. `q` searches titles and messages; `project` is a
 * project's id, or none for chats started outside a project.
 */
export async function GET(request: Request) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return forbidden();
  const search = new URL(request.url).searchParams;
  const limit = Number(search.get("limit"));
  const options: ChatListOptions = {
    ...(search.has("limit") && Number.isInteger(limit) && limit >= 0 ? { limit } : {}),
    ...(search.get("q") ? { query: search.get("q")! } : {}),
    ...(search.get("project") ? { projectId: search.get("project")! } : {}),
  };
  return Response.json(await listChats(getDb(), options));
}

/** Starts a chat, titled after its first message, in the project of the dashboard page `path` names, and returns it as the list shows it. */
export async function POST(request: Request) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return forbidden();
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; path?: unknown };
  const path = typeof body.path === "string" && /^\/(?!\/)/.test(body.path) ? body.path : undefined;
  const conversation = await createConversation(getDb(), typeof body.text === "string" ? body.text : "", path ? { path } : {});
  // The chat as the list shows it, with its project's name.
  return Response.json((await getChat(getDb(), conversation.id)) ?? conversation);
}
