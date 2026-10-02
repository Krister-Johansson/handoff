import { afterAll, beforeEach, expect, test } from "vitest";
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { eq, questions } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { answerQuestion } from "../operations.ts";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";
import type { ExecutorRegistry } from "../types.ts";
import { cliNodeExecutor } from "./cli-node.ts";
import { humanGateExecutor } from "./human-gate.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

function registry(cli: FakeCliExecutor, overrides: Partial<ExecutorRegistry> = {}): ExecutorRegistry {
  const agent = cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 });
  return {
    planner: agent,
    coder: agent,
    tester: scripted(done(outputs.testsPass)),
    reviewer: scripted(done(outputs.approve)),
    pr: scripted({ kind: "waiting", wait: { kind: "github_pr", key: "stop-here" } }),
    human_gate: humanGateExecutor({ db }),
    ...overrides,
  };
}

async function askingRun(asks: unknown = outputs.coderAsks) {
  const cli = new FakeCliExecutor([{ output: outputs.planner }, { output: asks }]);
  const { run } = await startRun(db, loop);
  const deps = engineDeps(db, registry(cli));
  await drain(deps);
  return { cli, run, deps };
}

test("Human gate stores the Coder's question and yields waiting on its token", async () => {
  const { run } = await askingRun();
  const { executions, run: row, types } = await inspect(db, run.id);
  const gate = executions.find((e) => e.nodeKey === "gate")!;
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  expect(question).toMatchObject({ question: "ISO dates or US dates?", options: ["ISO", "US"], nodeExecutionId: gate.id, answer: null });
  expect(gate).toMatchObject({ status: "waiting", waitKind: "human", waitToken: question!.id });
  expect(row.status).toBe("waiting");
  expect(types).toContain("human.asked");
});

test("Human gate keeps the summary the Coder wrote for its question, next to the full text", async () => {
  const text = "The changelog has dates in two formats. ISO sorts, US matches the README. ISO dates or US dates?";
  const { run } = await askingRun({ ...outputs.coderAsks, question: { text, summary: "ISO or US dates in the changelog?", options: ["ISO", "US"] } });
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  expect(question).toMatchObject({ question: text, context: { reason: "needs_input", summary: "ISO or US dates in the changelog?" } });
});

test("Coder resumed after a needs_input answer passes --resume with the recorded session id and the answer in the prompt", async () => {
  const { cli, run, deps } = await askingRun();
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  const firstCoder = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "coder")!;
  cli.push({ output: outputs.coderDone });

  await answerQuestion(db, question!.id, { answer: "Use ISO 8601 dates.", option: "ISO", answeredBy: "krister" });
  await drain(deps);

  const { executions, run: row, types } = await inspect(db, run.id);
  expect(executions.find((e) => e.nodeKey === "gate")!.status).toBe("passed");
  const resumed = cli.requests[2]!;
  expect(resumed.session).toEqual({ mode: "resume", id: firstCoder.id });
  expect(resumed.prompt).toContain("Use ISO 8601 dates.");
  expect(row.state).toMatchObject({ human: { gate: { answer: "Use ISO 8601 dates.", option: "ISO", answeredBy: "krister" } } });
  expect(executions.filter((e) => e.nodeKey === "coder").map((e) => e.status)).toEqual(["passed", "passed"]);
  expect(types).toContain("human.answered");
});

test("answering a question twice is refused", async () => {
  const { run } = await askingRun();
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  await answerQuestion(db, question!.id, { answer: "ISO", answeredBy: "a" });
  await expect(answerQuestion(db, question!.id, { answer: "US", answeredBy: "b" })).rejects.toThrow(/already answered/);
});

test("a gate reached by loop exhaustion asks whether to retry and offers abort", async () => {
  const cli = new FakeCliExecutor([{ output: outputs.planner }, ...Array.from({ length: 4 }, () => ({ output: outputs.coderDone }))]);
  const { run } = await startRun(db, loop);
  await drain(engineDeps(db, registry(cli, { tester: scripted(done(outputs.testsFail)) })));
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  expect(question!.question).toMatch(/tester->coder/);
  expect(question!.options).toEqual(["retry", "abort"]);
});
