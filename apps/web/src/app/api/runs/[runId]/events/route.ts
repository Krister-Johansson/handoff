import { getDb } from "@/lib/db";
import { eventsResponse } from "@/server/events-stream";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return eventsResponse(getDb(), runId, request);
}
