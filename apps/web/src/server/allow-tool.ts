import { nodeCatalog, type NodeType } from "@handoff/core";
import { and, eq, graphs, graphVersions, nodeExecutions, runs, type Db } from "@handoff/db";
import { saveGraphVersion } from "./graphs";

type GraphNode = { key: string; attributes: { type: NodeType; config?: Record<string, unknown> } };

/**
 * Lets a node use a tool the CLI denied it: adds the permission rule to that node in the graph's
 * latest version, starting from the node's default tools, and saves a new version, so the next run gets
 * the rule. The run that asked stays on its pinned version: the rule recorded on its permission request
 * covers the rest of that run.
 */
export async function allowToolForNode(db: Db, input: { runId: string; executionId: string; rule: string }) {
  const [row] = await db
    .select({ nodeKey: nodeExecutions.nodeKey, projectId: runs.projectId, graphId: graphVersions.graphId })
    .from(nodeExecutions)
    .innerJoin(runs, eq(runs.id, nodeExecutions.runId))
    .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
    .where(and(eq(nodeExecutions.id, input.executionId), eq(nodeExecutions.runId, input.runId)));
  if (!row) throw new Error("That step is not part of this run.");
  const [graph] = await db.select().from(graphs).where(eq(graphs.id, row.graphId));
  const [latest] = await db
    .select({ document: graphVersions.document })
    .from(graphVersions)
    .where(and(eq(graphVersions.graphId, row.graphId), eq(graphVersions.version, graph!.latestVersion)));
  const document = structuredClone(latest!.document) as { nodes: GraphNode[] };
  const node = document.nodes.find((n) => n.key === row.nodeKey);
  if (!node) throw new Error(`The latest version of ${graph!.name} has no node ${row.nodeKey}.`);
  const config = (node.attributes.config ??= {});
  const current = Array.isArray(config.allowedTools) ? config.allowedTools.map(String) : [...nodeCatalog[node.attributes.type].allowedTools];
  const unchanged = { graph: graph!.name, version: graph!.latestVersion, node: row.nodeKey };
  if (config.allTools === true || current.includes(input.rule)) return unchanged;
  config.allowedTools = [...current, input.rule];
  const saved = await saveGraphVersion(db, { projectId: row.projectId, name: graph!.name, document, createdBy: "dashboard" });
  if (!saved.ok) throw new Error(saved.errors.map((e) => e.message).join("; "));
  return { graph: graph!.name, version: saved.version, node: row.nodeKey };
}
