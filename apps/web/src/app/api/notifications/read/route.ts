import { getDb } from "@/lib/db";
import { markNotificationsRead } from "@/server/notifications";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

/** Marks the notification feed read up to a time, when the person opens the bell. Only the local dashboard may ask. */
export async function POST(request: Request) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { until?: unknown };
  const until = typeof body.until === "string" ? new Date(body.until) : undefined;
  if (!until || Number.isNaN(until.getTime())) return Response.json({ error: "until must be an ISO time" }, { status: 400 });
  await markNotificationsRead(getDb(), until);
  return Response.json({ read: true });
}
