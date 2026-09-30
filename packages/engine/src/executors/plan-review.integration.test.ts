import { afterAll, beforeEach, expect, test } from "vitest";
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

const plan = { plan: "Store todos in a JSON file and add a CLI.", steps: ["Add storage", "Add the CLI"], ownedPaths: ["src/todos.ts"] };

/** planner -> gate (review); the gate's changes go back to the planner's feedback input, approve goes on to the coder. */
const reviewGraph = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", config: { instructions: "Keep the plan to two steps." }, x: 0, y: 0 } },
    { key: "gate", attributes: { type: "human_gate", x: 300, y: 0 } },
    { key: "coder", attributes: { type: "coder", x: 600, y: 0 } },
  ],
  edges: [
    { key: "planner->gate", source: "planner", target: "gate", attributes: { port: "done" } },
    { key: "gate->planner", source: "gate", target: "planner", attributes: { port: "changes", input: "feedback" } },
    { key: "gate->coder", source: "gate", target: "coder", attributes: { port: "approve" } },
  ],
};

function registry(cli: FakeCliExecutor): ExecutorRegistry {
  const agent = cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 });
  return { planner: agent, coder: scripted(done(outputs.coderDone)), human_gate: humanGateExecutor({ db }) };
}

async function planned() {
  const cli = new FakeCliExecutor([{ output: plan }]);
  const { run } = await startRun(db, reviewGraph, "Build a todo app");
  const deps = engineDeps(db, registry(cli));
  await drain(deps);
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  return { cli, run, deps, question: question! };
}

test("a step's instructions reach its agent in the system prompt and the prompt", async () => {
  const { cli } = await planned();
  expect(cli.requests[0]!.systemPrompt).toContain("# Instructions for this step\n\nKeep the plan to two steps.");
  expect(cli.requests[0]!.prompt).toMatch(/instructions for this step/i);
});

test("a gate after a planner asks for a review of the plan and keeps the plan to show", async () => {
  const { question } = await planned();
  expect(question).toMatchObject({ question: "Review the plan from planner", options: ["approve", "changes"], answer: null });
  const review = (question.context as { review?: { from: string; kind: string; markdown: string } }).review;
  expect(review).toMatchObject({ from: "planner", kind: "plan" });
  expect(review?.markdown).toContain("Store todos in a JSON file and add a CLI.");
  expect(review?.markdown).toContain("1. Add storage");
});

test("asking for changes sends the planner back with the note and each comment on its quoted text", async () => {
  const { cli, run, deps, question } = await planned();
  cli.push({ output: { ...plan, plan: "Store todos in SQLite and add a CLI." } });
  await answerQuestion(db, question.id, {
    answer: "Close, one change.",
    option: "changes",
    comments: [{ quote: "Store todos in a JSON file", body: "Use SQLite instead." }],
    answeredBy: "krister",
  });
  await drain(deps);

  const [answered] = await db.select().from(questions).where(eq(questions.id, question.id));
  expect(answered?.comments).toEqual([{ quote: "Store todos in a JSON file", body: "Use SQLite instead." }]);
  const retry = cli.requests[1]!;
  expect(retry.systemPrompt).toContain('- person on "Store todos in a JSON file": Use SQLite instead.');
  expect(retry.systemPrompt).toContain("changes: Close, one change.");
  expect(retry.prompt).toMatch(/sent back/i);
  const planners = (await inspect(db, run.id)).executions.filter((e) => e.nodeKey === "planner");
  expect(planners.map((e) => e.attempt)).toEqual([1, 2]);
});

test("approving the plan moves on to the coder", async () => {
  const { run, deps, question } = await planned();
  await answerQuestion(db, question.id, { answer: "Looks good.", option: "approve", answeredBy: "krister" });
  await drain(deps);
  const { executions, run: row } = await inspect(db, run.id);
  expect(executions.find((e) => e.nodeKey === "coder")?.status).toBe("passed");
  expect(row.status).toBe("succeeded");
});

test("a gate after a plan reviewer shows the plan it reviewed, with the reviewer's verdict under it", async () => {
  const graph = {
    attributes: { startNode: "planner" },
    nodes: [
      { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
      { key: "plan-review", attributes: { type: "reviewer", x: 300, y: 0 } },
      { key: "gate", attributes: { type: "human_gate", x: 600, y: 0 } },
    ],
    edges: [
      { key: "planner->plan-review", source: "planner", target: "plan-review", attributes: { port: "done" } },
      { key: "plan-review->planner", source: "plan-review", target: "planner", attributes: { port: "changes", input: "feedback" } },
      { key: "plan-review->gate", source: "plan-review", target: "gate", attributes: { port: "approve" } },
      { key: "gate->planner", source: "gate", target: "planner", attributes: { port: "changes", input: "feedback" } },
    ],
  };
  const cli = new FakeCliExecutor([{ output: plan }]);
  const reviewed = { verdict: "approve", comments: [{ path: "plan", body: "Covers the issue." }] };
  const { run } = await startRun(db, graph, "Build a todo app");
  await drain(engineDeps(db, { planner: cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 }), reviewer: scripted(done(reviewed)), human_gate: humanGateExecutor({ db }) }));
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  expect(question?.question).toBe("Review the plan from planner");
  const review = (question?.context as { review: { from: string; kind: string; markdown: string } }).review;
  expect(review).toMatchObject({ from: "planner", kind: "plan" });
  expect(review.markdown).toContain("Store todos in a JSON file and add a CLI.");
  expect(review.markdown).toContain("## Review by plan-review");
  expect(review.markdown).toContain("Covers the issue.");
});
