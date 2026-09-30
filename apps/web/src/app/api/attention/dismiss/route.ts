import { getDb } from "@/lib/db";
import { dismissAttention } from "@/server/attention";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

/** Takes a finished run off the bell once the person has seen it. Only the local dashboard may ask. */
export async function POST(request: Request) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { itemId?: unknown };
  if (typeof body.itemId !== "string") return Response.json({ error: "itemId is required" }, { status: 400 });
  try {
    await dismissAttention(getDb(), body.itemId);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  return Response.json({ dismissed: true });
}
