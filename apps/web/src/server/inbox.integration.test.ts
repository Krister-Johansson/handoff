import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, nodeExecutions, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, seedRun, truncateAll } from "@handoff/db/testing";
import { listInbox } from "./inbox.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("inbox lists unanswered questions with run and node context", async () => {
  const { run, project } = await seedRun(db, { status: "waiting" });
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: run.id, nodeExecutionId: gate.id, question: "ISO or US dates?", options: ["ISO", "US"], context: { reason: "needs_input", from: "coder" } });
  const inbox = await listInbox(db);
  expect(inbox.questions).toEqual([
    expect.objectContaining({ question: "ISO or US dates?", options: ["ISO", "US"], runId: run.id, task: "t", nodeKey: "gate", projectName: project.name, reason: "needs_input" }),
  ]);
  expect(inbox.count).toBe(1);
});

test("answered questions leave the inbox", async () => {
  const { run } = await seedRun(db, { status: "waiting" });
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: run.id, nodeExecutionId: gate.id, question: "Q?", answer: "yes", answeredBy: "me", answeredAt: new Date() });
  expect((await listInbox(db)).questions).toEqual([]);
});

test("failed runs awaiting repair are listed with the failed node and its error", async () => {
  const { run } = await seedRun(db, { status: "running" });
  await seedExecution(db, run.id, { nodeKey: "planner", status: "passed" });
  const failed = await seedExecution(db, run.id, { nodeKey: "tester", nodeType: "tester", executorKind: "shell", status: "failed", error: { code: "no_command", message: "tester has no command" } });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run.id));
  const inbox = await listInbox(db);
  expect(inbox.failedRuns).toEqual([expect.objectContaining({ runId: run.id, nodeKey: "tester", executionId: failed.id, error: { code: "no_command", message: "tester has no command" } })]);
});

test("failed runs whose failed node was already repaired are not listed", async () => {
  const { run } = await seedRun(db, { status: "running" });
  await seedExecution(db, run.id, { nodeKey: "tester", status: "repaired" });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run.id));
  await db.update(nodeExecutions).set({ status: "repaired" });
  expect((await listInbox(db)).failedRuns).toEqual([]);
});
