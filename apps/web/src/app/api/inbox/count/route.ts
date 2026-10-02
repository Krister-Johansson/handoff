import { getDb } from "@/lib/db";
import { inboxTotal } from "@/server/inbox-groups";

export const dynamic = "force-dynamic";

/** How many items wait in the Inbox, for the sidebar's badge. */
export async function GET() {
  return Response.json({ count: await inboxTotal(getDb()) });
}
