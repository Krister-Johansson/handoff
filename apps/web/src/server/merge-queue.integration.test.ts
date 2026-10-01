import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, runs, sql } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { projectMergeQueue } from "./merge-queue";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const withMode = (mode?: string) => ({
  ...linear,
  nodes: linear.nodes.map((n) => (n.key === "merge" && mode ? { ...n, attributes: { ...n.attributes, config: { mode } } } : n)),
});

test("the queue lists ready pull requests in order, each with whether its graph merges on its own", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "manual", document: withMode() });
  await saveGraphVersion(db, { projectId: project.id, name: "auto", document: withMode("auto") });
  const first = await startRunFromGraph(db, { projectId: project.id, graphName: "auto", task: "First" });
  const second = await startRunFromGraph(db, { projectId: project.id, graphName: "manual", task: "Second" });
  await startRunFromGraph(db, { projectId: project.id, graphName: "manual", task: "Not ready" });
  await db.update(runs).set({ mergeQueuedAt: sql`now() - interval '2 minutes'`, prNumber: 7 }).where(eq(runs.id, first.id));
  await db.update(runs).set({ mergeQueuedAt: sql`now() - interval '1 minute'`, prNumber: 8 }).where(eq(runs.id, second.id));

  expect((await projectMergeQueue(db, project.id)).map((r) => [r.task, r.position, r.prNumber, r.mode])).toEqual([
    ["First", 1, 7, "auto"],
    ["Second", 2, 8, "manual"],
  ]);
});
