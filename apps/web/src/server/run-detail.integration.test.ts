import planReview from "@handoff/core/fixtures/plan-review.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { edgeTraversals, eq, nodeExecutions } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { getRunDetail } from "./queries";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("a passed execution that took a loop edge reads as sent back, one that went on as passed", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: planReview });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build it" });
  const sentBack = await seedExecution(db, run.id, { nodeKey: "plan-review", nodeType: "reviewer", status: "passed" });
  const wentOn = await seedExecution(db, run.id, { nodeKey: "plan-review", nodeType: "reviewer", attempt: 2, status: "passed" });
  await db.insert(edgeTraversals).values([
    { runId: run.id, edgeKey: "plan-review->planner", fromExecutionId: sentBack.id, toNodeKey: "planner" },
    { runId: run.id, edgeKey: "plan-review->approval", fromExecutionId: wentOn.id, toNodeKey: "approval" },
  ]);
  const detail = await getRunDetail(db, run.id);
  const status = (id: string) => detail!.executions.find((e) => e.id === id)?.status;
  expect(status(sentBack.id)).toBe("sent_back");
  expect(status(wentOn.id)).toBe("passed");
  expect((await db.select().from(nodeExecutions).where(eq(nodeExecutions.id, sentBack.id)))[0]?.status).toBe("passed");
});
