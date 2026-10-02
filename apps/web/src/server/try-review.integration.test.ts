import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, questions } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { getTryReview } from "./try-review";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function asked(context: Record<string, unknown>) {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Add projects" });
  const gate = await seedExecution(db, run.id, { nodeKey: "try", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db.insert(questions).values({ runId: run.id, nodeExecutionId: gate.id, question: "Try the app and check each acceptance criterion.", context }).returning();
  return { project, run, question: question! };
}

test("a Try it question reads as the app, the criteria, the screenshots, the warnings and where the work goes back", async () => {
  const { project, run, question } = await asked({
    reason: "try",
    acceptance: ["A user can create a new project"],
    preview: { id: "p1", url: "http://localhost:41000", status: "running" },
    shots: [{ id: "a1", caption: "The dialog", criterion: "A user can create a new project", works: true }],
    warnings: [{ source: "console", level: "warning", text: "Image is missing an alt attribute", new: true }],
  });
  expect(await getTryReview(db, run.id, question.id)).toEqual({
    id: question.id,
    question: "Try the app and check each acceptance criterion.",
    task: "Add projects",
    projectId: project.id,
    projectName: "sandbox",
    nodeKey: "try",
    backTo: "the coder",
    acceptance: ["A user can create a new project"],
    preview: { id: "p1", url: "http://localhost:41000", status: "running" },
    shots: [{ id: "a1", caption: "The dialog", criterion: "A user can create a new project", works: true }],
    warnings: [{ source: "console", level: "warning", text: "Image is missing an alt attribute", new: true }],
    answered: null,
  });
  await db.update(questions).set({ answer: "Approved.", option: "approve", answeredBy: "krister", answeredAt: new Date() }).where(eq(questions.id, question.id));
  expect((await getTryReview(db, run.id, question.id))!.answered).toMatchObject({ option: "approve", comments: [] });
});

test("a question that is not a Try it gate is not found here", async () => {
  const { run, question } = await asked({ reason: "approval" });
  expect(await getTryReview(db, run.id, question.id)).toBeUndefined();
});
