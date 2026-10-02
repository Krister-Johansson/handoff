import { and, asc, eq, nodeExecutions, permissionRequests, projects, runs, type Db } from "@handoff/db";
import type { PermissionRequestView } from "../components/runs/permission-card";

/** A run's permission requests still waiting for a person, oldest first. */
export async function pendingPermissions(db: Db, runId: string): Promise<PermissionRequestView[]> {
  const rows = await db
    .select({ id: permissionRequests.id, runId: permissionRequests.runId, nodeKey: nodeExecutions.nodeKey, toolName: permissionRequests.toolName, input: permissionRequests.input, createdAt: permissionRequests.createdAt })
    .from(permissionRequests)
    .innerJoin(nodeExecutions, eq(nodeExecutions.id, permissionRequests.nodeExecutionId))
    .where(and(eq(permissionRequests.runId, runId), eq(permissionRequests.status, "pending")))
    .orderBy(asc(permissionRequests.createdAt));
  return rows;
}

/** The step a permission request came from. */
export async function permissionExecution(db: Db, id: string): Promise<string> {
  const [row] = await db.select({ executionId: permissionRequests.nodeExecutionId }).from(permissionRequests).where(eq(permissionRequests.id, id));
  if (!row) throw new Error("That request does not exist.");
  return row.executionId;
}

/** Every run's permission requests still waiting for a person, oldest first, with their run and project. Demo runs stay out. */
export async function allPendingPermissions(db: Db) {
  return db
    .select({
      id: permissionRequests.id,
      runId: permissionRequests.runId,
      nodeKey: nodeExecutions.nodeKey,
      toolName: permissionRequests.toolName,
      input: permissionRequests.input,
      createdAt: permissionRequests.createdAt,
      projectId: projects.id,
      projectName: projects.name,
      task: runs.task,
    })
    .from(permissionRequests)
    .innerJoin(nodeExecutions, eq(nodeExecutions.id, permissionRequests.nodeExecutionId))
    .innerJoin(runs, eq(runs.id, permissionRequests.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(eq(permissionRequests.status, "pending"), eq(projects.isDemo, false)))
    .orderBy(asc(permissionRequests.createdAt));
}
