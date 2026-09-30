import { getDb } from "@/lib/db";
import { getExecutionDetail } from "@/server/queries";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_: Request, { params }: { params: Promise<{ runId: string; executionId: string }> }) {
  const { runId, executionId } = await params;
  if (!UUID.test(runId) || !UUID.test(executionId)) return Response.json({ error: "not found" }, { status: 404 });
  const detail = await getExecutionDetail(getDb(), runId, executionId);
  if (!detail) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(detail);
}
