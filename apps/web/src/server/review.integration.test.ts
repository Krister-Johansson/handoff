import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { questions } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { getReview } from "./review";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("a review question comes with its run, what to review and, once answered, the answer and comments", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build a todo app" });
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db
    .insert(questions)
    .values({ runId: run.id, nodeExecutionId: gate.id, question: "Review the plan from planner", context: { reason: "approval", review: { from: "planner", kind: "plan", markdown: "# Plan" } } })
    .returning();

  expect(await getReview(db, run.id, question!.id)).toMatchObject({
    id: question!.id,
    question: "Review the plan from planner",
    review: { from: "planner", kind: "plan", markdown: "# Plan" },
    task: "Build a todo app",
    projectName: "sandbox",
    answered: null,
  });
  expect(await getReview(db, crypto.randomUUID(), question!.id)).toBeUndefined();
});
