import { getDb } from "@/lib/db";
import { allowToolForNode } from "@/server/allow-tool";
import { isSameLocalOrigin } from "@/server/local-request";

export const dynamic = "force-dynamic";

/** Adds a permission rule the CLI denied to the step's node, as a new graph version. Only the local dashboard may ask. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string; executionId: string }> }) {
  if (!isSameLocalOrigin(request.headers.get("origin"), request.headers.get("host"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const { runId, executionId } = await params;
  const body = (await request.json().catch(() => ({}))) as { rule?: unknown };
  if (typeof body.rule !== "string" || !body.rule.trim() || body.rule.length > 500) return Response.json({ error: "rule is required" }, { status: 400 });
  try {
    return Response.json(await allowToolForNode(getDb(), { runId, executionId, rule: body.rule.trim() }));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
