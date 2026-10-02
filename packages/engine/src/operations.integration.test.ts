import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { permissionRequests, questions } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { answerQuestion, cancelRun, decidePermission, repairNodeExecution, resolveExhaustedLoop } from "./operations.ts";
import { drain, engineDeps, inspect, startRun } from "./testing/harness.ts";
import { schedulerOn } from "./testing/scheduler.ts";
import { done, outputs, scripted } from "./testing/scripted.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** A reviewer that may send the work back once, with no gate for when that runs out. */
const stuckLoop = {
  attributes: { startNode: "coder" },
  nodes: [
    { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
    { key: "reviewer", attributes: { type: "reviewer", x: 300, y: 0 } },
  ],
  edges: [
    { key: "coder->reviewer", source: "coder", target: "reviewer", attributes: { port: "done" } },
    { key: "reviewer->coder", source: "reviewer", target: "coder", attributes: { port: "changes", maxAttempts: 1 } },
  ],
};

/** An active run of its own project, with that project's scheduler on and its next check 30 seconds away. */
async function activeRun(document: unknown = linear) {
  const { project, run } = await startRun(db, document);
  const scheduler = await schedulerOn(db, project.id);
  const [execution] = (await inspect(db, run.id)).executions;
  return { project, run, execution: execution!, scheduler };
}

/** A run whose first step failed; the run's end already nudged, so the scheduler is set back to 30 seconds away. */
async function failedRun(document: unknown, executors: Parameters<typeof engineDeps>[1]) {
  const active = await activeRun(document);
  await drain(engineDeps(db, executors));
  expect((await inspect(db, active.run.id)).run.status).toBe("failed");
  await active.scheduler.reset();
  return active;
}

test("answering a question, deciding a permission, repairing, resolving a loop and cancelling nudge the scheduler", async () => {
  const asked = await activeRun();
  const [question] = await db.insert(questions).values({ runId: asked.run.id, nodeExecutionId: asked.execution.id, question: "ISO dates or US dates?", options: ["ISO", "US"] }).returning();
  await answerQuestion(db, question!.id, { answer: "ISO", option: "ISO", answeredBy: "krister" });
  expect(await asked.scheduler.due()).toBe(0);

  const permission = await activeRun();
  const [request] = await db
    .insert(permissionRequests)
    .values({ id: crypto.randomUUID(), runId: permission.run.id, nodeExecutionId: permission.execution.id, toolName: "Bash", input: { command: "rm -rf dist" } })
    .returning();
  await decidePermission(db, request!.id, { allow: false, decidedBy: "krister", message: "Not that" });
  expect(await permission.scheduler.due()).toBe(0);

  const failed = await failedRun(linear, { planner: scripted({ kind: "failed", error: { code: "boom", message: "boom" } }) });
  await repairNodeExecution(db, failed.execution.id, { note: "Try again" });
  expect(await failed.scheduler.due()).toBe(0);

  const stuck = await failedRun(stuckLoop, { coder: scripted(done(outputs.coderDone)), reviewer: scripted(done(outputs.requestChanges)) });
  await resolveExhaustedLoop(db, stuck.run.id, "retry");
  expect(await stuck.scheduler.due()).toBe(0);

  const cancelled = await activeRun();
  await cancelRun(db, cancelled.run.id);
  expect(await cancelled.scheduler.due()).toBe(0);
});
