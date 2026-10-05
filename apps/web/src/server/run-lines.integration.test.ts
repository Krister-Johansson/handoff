import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, nodeExecutions, permissionRequests, questions, reviewItems, runs } from "@handoff/db";
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

test("a run whose step waits on a permission request says what the step asks to do, and which step waits since when", async () => {
  const { run } = await projectWithRun();
  const coder = await setPlanner(run.id, { status: "running" });
  const asked = new Date("2026-10-05T09:00:00Z");
  await db
    .insert(permissionRequests)
    .values({ id: crypto.randomUUID(), runId: run.id, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "npx playwright install chromium" }, createdAt: asked });
  await db.update(runs).set({ status: "running" }).where(eq(runs.id, run.id));

  const line = (await runLines(db, [run.id])).get(run.id);
  expect(line?.now).toEqual({ tone: "attention", text: "Plan asks to run a command" });
  expect(line?.waitingOn).toEqual({ kind: "permission", nodeKey: "planner", since: asked });
});

test("a run whose PR step waits for a reviewer's next review after handoff's answers says whose, in blue, waiting on review", async () => {
  const { run } = await projectWithRun();
  await setPlanner(run.id, { status: "passed" });
  const pr = await seedExecution(db, run.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", waitKind: "github_pr" });
  const answered = new Date("2026-10-05T14:31:00Z");
  await db.insert(reviewItems).values({ runId: run.id, handle: 1, key: "thread:PRRT_1", kind: "thread", reviewer: "coderabbitai", reviewerBot: true, body: "Handle the empty list.", round: 1, state: "awaiting_review", repliedAt: answered });
  await db.transaction((tx) =>
    appendEvents(tx, run.id, [
      { type: "github.pr", payload: { number: 9 }, nodeExecutionId: pr.id },
      { type: "github.re_review", payload: { number: 9, reviewers: ["coderabbitai"], items: ["R1"], until: null, due: {} }, nodeExecutionId: pr.id },
    ]),
  );
  await db.update(runs).set({ status: "waiting", prNumber: 9 }).where(eq(runs.id, run.id));

  const line = (await runLines(db, [run.id])).get(run.id);
  expect(line?.now).toEqual({ tone: "active", text: "Waiting for CodeRabbit's next review, 1 comment answered" });
  expect(line?.waitingOn).toEqual({ kind: "re_review", nodeKey: "pr", since: answered });
});

test("a run with no open permission request has no wait on its line", async () => {
  const { run } = await projectWithRun();
  await setPlanner(run.id, { status: "running" });

  expect((await runLines(db, [run.id])).get(run.id)).not.toHaveProperty("waitingOn");
});

test("a run's line lists its steps so far in order, each once with how often it ran, and when the current step began", async () => {
  const { run } = await projectWithRun();
  const now = Date.now();
  const minutesAgo = (n: number) => new Date(now - n * 60_000);
  await setPlanner(run.id, { status: "passed", createdAt: minutesAgo(30), startedAt: minutesAgo(30) });
  await seedExecution(db, run.id, { nodeKey: "coder", status: "failed", createdAt: minutesAgo(20), startedAt: minutesAgo(20) });
  await seedExecution(db, run.id, { nodeKey: "coder", attempt: 2, status: "passed", createdAt: minutesAgo(15), startedAt: minutesAgo(15) });
  await seedExecution(db, run.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", createdAt: minutesAgo(11), startedAt: minutesAgo(10) });
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, run.id));

  const line = (await runLines(db, [run.id])).get(run.id)!;
  expect(line.steps).toEqual([
    { nodeKey: "planner", status: "passed", times: 1 },
    { nodeKey: "coder", status: "passed", times: 2 },
    { nodeKey: "pr", status: "waiting", times: 1 },
  ]);
  expect(line.stepSince?.getTime()).toBe(minutesAgo(10).getTime());
});

test("a finished run has no current step", async () => {
  const { run } = await projectWithRun();
  await setPlanner(run.id, { status: "passed" });
  await db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, run.id));
  expect((await runLines(db, [run.id])).get(run.id)?.stepSince).toBeNull();
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
