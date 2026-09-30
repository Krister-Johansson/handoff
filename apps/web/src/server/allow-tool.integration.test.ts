import planReview from "@handoff/core/fixtures/plan-review.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { nodeCatalog } from "@handoff/core";
import { and, eq, graphs, graphVersions } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { allowToolForNode } from "./allow-tool";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function latest(projectId: string) {
  const [row] = await db
    .select({ version: graphVersions.version, document: graphVersions.document })
    .from(graphVersions)
    .innerJoin(graphs, and(eq(graphs.id, graphVersions.graphId), eq(graphs.latestVersion, graphVersions.version)))
    .where(and(eq(graphs.projectId, projectId), eq(graphs.name, "g")));
  return row!;
}

const nodeConfig = (document: unknown, key: string) =>
  ((document as { nodes: { key: string; attributes: { config: Record<string, unknown> } }[] }).nodes.find((n) => n.key === key)!.attributes.config);

test("allowing a denied tool adds its rule to the node in the graph's latest version, keeping its default tools", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: planReview });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build it" });
  const planner = await seedExecution(db, run.id, { nodeKey: "planner", nodeType: "planner", attempt: 2 });

  expect(await allowToolForNode(db, { runId: run.id, executionId: planner.id, rule: "Bash(gh issue *)" })).toEqual({ graph: "g", version: 2, node: "planner" });
  const tools = nodeConfig((await latest(project.id)).document, "planner").allowedTools as string[];
  expect(tools).toEqual([...nodeCatalog.planner.allowedTools, "Bash(gh issue *)"]);

  // Allowing it again changes nothing.
  expect(await allowToolForNode(db, { runId: run.id, executionId: planner.id, rule: "Bash(gh issue *)" })).toEqual({ graph: "g", version: 2, node: "planner" });
});
