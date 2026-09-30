import { eq, inArray } from "drizzle-orm";
import type { Db } from "../client.ts";
import { edgeTraversals, events, graphs, graphVersions, nodeExecutions, projects, questions, runs, type ProjectLibrary } from "../schema/index.ts";

/** Deletes a project and everything that belongs to it. Used by pnpm demo --reset. */
export async function deleteProject(db: Db, projectId: string) {
  await db.transaction(async (tx) => {
    const runIds = (await tx.select({ id: runs.id }).from(runs).where(eq(runs.projectId, projectId))).map((r) => r.id);
    if (runIds.length) {
      await tx.delete(events).where(inArray(events.runId, runIds));
      await tx.delete(questions).where(inArray(questions.runId, runIds));
      await tx.delete(edgeTraversals).where(inArray(edgeTraversals.runId, runIds));
      await tx.update(nodeExecutions).set({ repairedFromExecutionId: null }).where(inArray(nodeExecutions.runId, runIds));
      await tx.delete(nodeExecutions).where(inArray(nodeExecutions.runId, runIds));
      await tx.delete(runs).where(inArray(runs.id, runIds));
    }
    const graphIds = (await tx.select({ id: graphs.id }).from(graphs).where(eq(graphs.projectId, projectId))).map((g) => g.id);
    if (graphIds.length) {
      await tx.delete(graphVersions).where(inArray(graphVersions.graphId, graphIds));
      await tx.delete(graphs).where(inArray(graphs.id, graphIds));
    }
    await tx.delete(projects).where(eq(projects.id, projectId));
  });
}

/** Sets the library entries every CLI node in the project's runs gets. */
export async function setProjectLibrary(db: Db, projectId: string, library: ProjectLibrary) {
  const [row] = await db.update(projects).set({ library }).where(eq(projects.id, projectId)).returning();
  return row;
}
