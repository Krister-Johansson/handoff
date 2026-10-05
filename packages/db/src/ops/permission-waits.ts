import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { nodeExecutions, permissionRequests } from "../schema/index.ts";

/**
 * A run that waits on a person to allow or deny a tool call. Its status stays running; this says why it
 * does not move. nodeKey is the step that asked, since is when its oldest open request was made, and
 * toolName and input are that request's.
 */
export type PermissionWait = { kind: "permission"; nodeKey: string; since: Date; toolName: string; input: Record<string, unknown> };

/**
 * The runs among runIds that wait on a permission request, keyed by run id: each one's oldest pending request
 * on a step that still runs. The CLI, the MCP tools and the dashboard all read the wait from here.
 */
export async function permissionWaits(db: DbExecutor, runIds: string[]): Promise<Map<string, PermissionWait>> {
  const waits = new Map<string, PermissionWait>();
  if (runIds.length === 0) return waits;
  const rows = await db
    .selectDistinctOn([permissionRequests.runId], {
      runId: permissionRequests.runId,
      nodeKey: nodeExecutions.nodeKey,
      since: permissionRequests.createdAt,
      toolName: permissionRequests.toolName,
      input: permissionRequests.input,
    })
    .from(permissionRequests)
    .innerJoin(nodeExecutions, eq(nodeExecutions.id, permissionRequests.nodeExecutionId))
    .where(and(inArray(permissionRequests.runId, runIds), eq(permissionRequests.status, "pending"), eq(nodeExecutions.status, "running")))
    .orderBy(permissionRequests.runId, asc(permissionRequests.createdAt));
  for (const { runId, ...wait } of rows) waits.set(runId, { kind: "permission", ...wait });
  return waits;
}
