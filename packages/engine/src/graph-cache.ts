import { eq } from "drizzle-orm";
import { compileGraph, type CompiledGraph } from "@handoff/core";
import { graphVersions, type DbExecutor } from "@handoff/db";

const cache = new Map<string, CompiledGraph>();

/** Graph versions are immutable, so compiled graphs are cached per version id. */
export async function loadCompiledGraph(db: DbExecutor, graphVersionId: string): Promise<CompiledGraph> {
  const hit = cache.get(graphVersionId);
  if (hit) return hit;
  const [version] = await db.select().from(graphVersions).where(eq(graphVersions.id, graphVersionId));
  if (!version) throw new Error(`graph version ${graphVersionId} not found`);
  const result = compileGraph(version.document);
  if (!result.ok) throw new Error(`graph version ${graphVersionId} does not compile: ${result.errors.map((e) => e.message).join("; ")}`);
  cache.set(graphVersionId, result.graph);
  return result.graph;
}
