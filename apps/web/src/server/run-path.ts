import { eq, runs, type Db } from "@handoff/db";
import { reviewPath, runPath, tryPath } from "../lib/paths";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a run (or one of its review or Try it pages) lives under its project, for /runs links; undefined for no such run. */
export async function runPathOf(db: Db, runId: string, questionId?: string, page: "review" | "try" = "review") {
  if (!UUID.test(runId)) return undefined;
  const [run] = await db.select({ projectId: runs.projectId }).from(runs).where(eq(runs.id, runId));
  if (!run) return undefined;
  if (!questionId) return runPath(run.projectId, runId);
  return page === "try" ? tryPath(run.projectId, runId, questionId) : reviewPath(run.projectId, runId, questionId);
}
