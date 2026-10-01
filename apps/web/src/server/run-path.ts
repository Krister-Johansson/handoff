import { eq, runs, type Db } from "@handoff/db";
import { reviewPath, runPath } from "../lib/paths";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a run (or one of its reviews) lives under its project, for old /runs links; undefined for no such run. */
export async function runPathOf(db: Db, runId: string, questionId?: string) {
  if (!UUID.test(runId)) return undefined;
  const [run] = await db.select({ projectId: runs.projectId }).from(runs).where(eq(runs.id, runId));
  if (!run) return undefined;
  return questionId ? reviewPath(run.projectId, runId, questionId) : runPath(run.projectId, runId);
}
