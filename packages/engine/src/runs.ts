import { eq } from "drizzle-orm";
import { initialRunState } from "@handoff/core";
import { appendEvents, nodeExecutions, projects, runs, type Db } from "@handoff/db";
import { loadCompiledGraph } from "./graph-cache.ts";
import type { RunRow } from "./types.ts";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "task";

/** Creates a queued run pinned to a graph version, with a pending execution for the start node. */
export async function createRun(
  db: Db,
  input: { projectId: string; graphVersionId: string; task: string; baseBranch?: string; branchName?: string },
): Promise<RunRow> {
  const graph = await loadCompiledGraph(db, input.graphVersionId);
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId));
  if (!project) throw new Error(`project ${input.projectId} not found`);
  const id = crypto.randomUUID();
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(runs)
      .values({
        id,
        projectId: project.id,
        graphVersionId: input.graphVersionId,
        status: "queued",
        task: input.task,
        state: initialRunState(input.task),
        baseBranch: input.baseBranch ?? project.defaultBranch,
        branchName: input.branchName ?? `handoff/${slug(input.task)}-${id.slice(0, 8)}`,
      })
      .returning();
    const start = graph.node(graph.startNode);
    const [execution] = await tx
      .insert(nodeExecutions)
      .values({ runId: id, nodeKey: start.key, nodeType: start.type, executorKind: graph.executorKind(start.key), attempt: 1 })
      .returning();
    await appendEvents(tx, id, [
      { type: "run.created", payload: { task: input.task, graphVersionId: input.graphVersionId, branchName: run!.branchName } },
      { type: "node.created", payload: { nodeKey: start.key, attempt: 1 }, nodeExecutionId: execution!.id },
    ]);
    return run!;
  });
}
