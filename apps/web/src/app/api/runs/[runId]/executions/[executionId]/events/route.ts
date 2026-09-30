import { getDb } from "@/lib/db";
import { listExecutionCliEvents } from "@/server/execution-events";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the agent in one execution said and did, for the drawer's activity. */
export async function GET(_: Request, { params }: { params: Promise<{ runId: string; executionId: string }> }) {
  const { runId, executionId } = await params;
  if (!UUID.test(runId) || !UUID.test(executionId)) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ events: await listExecutionCliEvents(getDb(), runId, executionId) });
}
