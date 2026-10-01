import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, nodeExecutions, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import { latestRuns, runLines } from "./run-lines.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function projectWithRun(task = "Add a CHANGELOG.md") {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "linear", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "linear", task });
  return { project, run };
}

/** Starting a run queues its planner; the tests move that step along themselves. */
async function setPlanner(runId: string, values: Partial<typeof nodeExecutions.$inferInsert>) {
  const [row] = await db.update(nodeExecutions).set(values).where(eq(nodeExecutions.runId, runId)).returning();
  return row!;
}

test("a run's line names its graph version, adds up its cost and says what it is doing with the node's label", async () => {
  const { run } = await projectWithRun();
  await setPlanner(run.id, { status: "passed", costUsd: "0.40" });
  await seedExecution(db, run.id, { nodeKey: "coder", status: "failed", costUsd: "1.10" });
  await seedExecution(db, run.id, { nodeKey: "coder", attempt: 2, status: "running", costUsd: null });
  await db.update(runs).set({ status: "running" }).where(eq(runs.id, run.id));

  const line = (await runLines(db, [run.id])).get(run.id);
  expect(line).toMatchObject({ graph: "linear", version: 1, now: { tone: "active", text: "Code is working, attempt 2" } });
  expect(line?.costUsd).toBeCloseTo(1.5);
  expect(line?.reviewHref).toBeUndefined();
});

test("a run waiting on a review links to the review", async () => {
  const { project, run } = await projectWithRun();
  const execution = await setPlanner(run.id, { status: "waiting" });
  const [question] = await db
    .insert(questions)
    .values({ runId: run.id, nodeExecutionId: execution.id, question: "Approve the plan?", context: { review: { from: "planner", kind: "plan" } } })
    .returning();
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, run.id));

  const line = (await runLines(db, [run.id])).get(run.id);
  expect(line?.now).toEqual({ tone: "attention", text: "Plan waits for your review" });
  expect(line?.reviewHref).toBe(`/projects/${project.id}/runs/${run.id}/review/${question!.id}`);
});

test("no runs asked for gives no lines", async () => {
  expect((await runLines(db, [])).size).toBe(0);
});

test("latestRuns gives each project its newest run", async () => {
  const { project } = await projectWithRun("First");
  const newer = await startRunFromGraph(db, { projectId: project.id, graphName: "linear", task: "Second" });
  await db.update(runs).set({ createdAt: new Date(Date.now() + 1000) }).where(eq(runs.id, newer.id));
  expect((await latestRuns(db)).get(project.id)).toMatchObject({ id: newer.id, task: "Second", status: "queued" });
});
