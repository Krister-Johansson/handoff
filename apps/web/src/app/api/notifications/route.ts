import { getDb } from "@/lib/db";
import { listNotifications } from "@/server/notifications";

export const dynamic = "force-dynamic";

/** The latest notifications and how many are unread, for the header bell. */
export async function GET() {
  return Response.json(await listNotifications(getDb(), { limit: 8 }));
}
