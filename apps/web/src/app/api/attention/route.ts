import { getDb } from "@/lib/db";
import { listAttention } from "@/server/attention";

export const dynamic = "force-dynamic";

/** What needs a person right now, for the header bell's notifications. */
export async function GET() {
  return Response.json({ items: await listAttention(getDb()) });
}
