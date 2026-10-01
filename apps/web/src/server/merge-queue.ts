import { eq, graphVersions, inArray, runs, type Db } from "@handoff/db";
import { mergeQueue } from "@handoff/engine/operations";
import type { QueueRow } from "../components/pulls/merge-queue";

/** The merge mode of a graph's merge node: manual unless it says auto. */
function modeOf(document: unknown): QueueRow["mode"] {
  const nodes = (document as { nodes?: { attributes?: { type?: string; config?: { mode?: unknown } } }[] }).nodes ?? [];
  return nodes.some((n) => n.attributes?.type === "merge" && n.attributes.config?.mode === "auto") ? "auto" : "manual";
}

/** The project's merge queue for the Pull requests tab, each run with the merge mode of the graph it runs. */
export async function projectMergeQueue(db: Db, projectId: string): Promise<QueueRow[]> {
  const entries = await mergeQueue(db, projectId);
  if (entries.length === 0) return [];
  const documents = await db
    .select({ runId: runs.id, document: graphVersions.document })
    .from(runs)
    .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
    .where(
      inArray(
        runs.id,
        entries.map((e) => e.runId),
      ),
    );
  const mode = new Map(documents.map((d) => [d.runId, modeOf(d.document)]));
  return entries.map((e) => ({ ...e, mode: mode.get(e.runId) ?? "manual" }));
}
