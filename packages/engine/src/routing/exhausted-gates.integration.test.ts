import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { questions } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { finishExecutor } from "../executors/flow.ts";
import { humanGateExecutor } from "../executors/human-gate.ts";
import { answerQuestion } from "../operations.ts";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/**
 * A plan loop shaped like NorthMES's graphs: the plan reviewer may send the plan back twice, and when
 * that runs out the plan's question gate asks a person. An approval gate follows the review.
 */
function planLoop(onExhausted = "plan-ask") {
  return {
    attributes: { startNode: "planner" },
    nodes: [
      { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
      { key: "plan-ask", attributes: { type: "human_gate", config: { mode: "question" }, x: 0, y: 200 } },
      { key: "plan-review", attributes: { type: "reviewer", x: 300, y: 0 } },
      { key: "plan-gate", attributes: { type: "human_gate", config: { mode: "approval" }, x: 600, y: 0 } },
      { key: "coder", attributes: { type: "coder", x: 900, y: 0 } },
      { key: "finish", attributes: { type: "finish", x: 1200, y: 0 } },
    ],
    edges: [
      { key: "planner->plan-review", source: "planner", target: "plan-review", attributes: { port: "done" } },
      { key: "planner->plan-ask", source: "planner", target: "plan-ask", attributes: { port: "needs_input" } },
      { key: "plan-ask->planner", source: "plan-ask", target: "planner", attributes: { port: "answered" } },
      { key: "plan-review->planner", source: "plan-review", target: "planner", attributes: { port: "changes", maxAttempts: 2, onExhausted } },
      { key: "plan-review->plan-gate", source: "plan-review", target: "plan-gate", attributes: { port: "approve" } },
      { key: "plan-gate->planner", source: "plan-gate", target: "planner", attributes: { port: "changes", maxAttempts: 5, onExhausted: "plan-ask" } },
      { key: "plan-gate->coder", source: "plan-gate", target: "coder", attributes: { port: "approve" } },
      { key: "coder->finish", source: "coder", target: "finish", attributes: { port: "done" } },
    ],
  };
}

const executors = () => ({
  planner: scripted(done(outputs.planner, { plan: outputs.planner })),
  reviewer: scripted(done(outputs.requestChanges)),
  coder: scripted(done(outputs.coderDone)),
  human_gate: humanGateExecutor({ db }),
  finish: finishExecutor(),
});

/** Runs the plan loop until the reviewer has sent the plan back twice and the gate asks. */
async function exhausted(onExhausted?: string) {
  const { run } = await startRun(db, planLoop(onExhausted));
  const deps = engineDeps(db, executors());
  await drain(deps);
  return { run, deps };
}

async function openQuestion(runId: string) {
  const [question] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.runId, runId), isNull(questions.answer)));
  return question;
}

describe("a gate reached by a loop that ran out", () => {
  test("asks the person to retry, continue or abort, and says what each does", async () => {
    const { run } = await exhausted();
    const { run: row, executions } = await inspect(db, run.id);
    expect(executions.filter((e) => e.nodeKey === "planner")).toHaveLength(3);
    expect(executions.at(-1)).toMatchObject({ nodeKey: "plan-ask", status: "waiting", trigger: expect.objectContaining({ kind: "exhausted", edgeKey: "plan-review->planner" }) });
    expect(row.status).toBe("waiting");
    const question = await openQuestion(run.id);
    expect(question!.options).toEqual(["retry", "continue", "abort"]);
    expect(question!.question).toBe(
      "plan-review sent the work back to planner 2 times on plan-review->planner, all the rounds the loop allows. Choose retry to give planner another round, with the loop's count starting over; continue to go on as if plan-review had approved; or abort to cancel the run.",
    );
  });

  test("continue goes on to the plan gate as if the reviewer approved, and says a person continued past it", async () => {
    const { run, deps } = await exhausted();
    const asked = await openQuestion(run.id);
    await answerQuestion(db, asked!.id, { answer: "The plan is fine as it is.", option: "continue", answeredBy: "krister" });
    await drain(deps);
    const { run: row, executions, events } = await inspect(db, run.id);
    expect(executions.filter((e) => e.nodeKey === "planner")).toHaveLength(3);
    expect(executions.at(-1)).toMatchObject({
      nodeKey: "plan-gate",
      status: "waiting",
      trigger: expect.objectContaining({ kind: "edge", edgeKey: "plan-review->plan-gate", from: "plan-review" }),
    });
    expect((await openQuestion(run.id))!.question).toBe("Review the plan from planner");
    const resolved = events.find((e) => e.type === "loop.resolved");
    expect(resolved?.payload).toEqual({ action: "continue", edgeKey: "plan-review->planner", nodeKey: "plan-review", gate: "plan-ask", by: "krister" });
    expect((row.state as { decisions?: unknown[] }).decisions).toEqual([
      {
        gate: "plan-ask",
        note: "krister went on past plan-review after plan-review->planner used all its rounds, as if plan-review had approved. Their note: The plan is fine as it is.",
        comments: [],
      },
    ]);

    const review = await openQuestion(run.id);
    await answerQuestion(db, review!.id, { answer: "Approved.", option: "approve", answeredBy: "krister" });
    await drain(deps);
    expect((await inspect(db, run.id)).run.status).toBe("succeeded");
  });

  test("abort cancels the run with an event naming the gate and the person, and releases its worktree", async () => {
    const { run } = await startRun(db, planLoop());
    // The planner works in the run's worktree, so the run has one to release.
    const deps = engineDeps(db, { ...executors(), planner: { ...scripted(done(outputs.planner, { plan: outputs.planner })), needsWorkdir: true } });
    await drain(deps);
    expect((await inspect(db, run.id)).run.worktreePath).not.toBeNull();
    const asked = await openQuestion(run.id);
    await answerQuestion(db, asked!.id, { answer: "abort", option: "abort", answeredBy: "krister" });
    const cancelled = await inspect(db, run.id);
    expect(cancelled.run.status).toBe("cancelled");
    expect(cancelled.executions.at(-1)).toMatchObject({ nodeKey: "plan-ask", status: "failed", error: { code: "cancelled" } });
    expect(cancelled.events.find((e) => e.type === "run.cancelled")?.payload).toEqual({
      reason: "krister chose abort at plan-ask after plan-review->planner used all its rounds",
      gate: "plan-ask",
      by: "krister",
    });
    await drain(deps);
    const { run: row, types } = await inspect(db, run.id);
    expect(row.worktreePath).toBeNull();
    expect(types).not.toContain("run.failed");
  });

  test("retry sends the work back to the planner with the reviewer's comments, and the loop's count starts over", async () => {
    const { run, deps } = await exhausted();
    const asked = await openQuestion(run.id);
    await answerQuestion(db, asked!.id, { answer: "retry", option: "retry", answeredBy: "krister" });
    await drain(deps);
    const { executions, events } = await inspect(db, run.id);
    const planners = executions.filter((e) => e.nodeKey === "planner");
    // The retry is the fresh loop's first round, the reviewer's next send-back its second, and then the gate asks again.
    expect(planners).toHaveLength(5);
    expect(planners[3]!.trigger).toMatchObject({ kind: "edge", edgeKey: "plan-review->planner", from: "plan-review" });
    expect(events.find((e) => e.type === "loop.resolved")?.payload).toMatchObject({ action: "retry", gate: "plan-ask", by: "krister" });
    const again = executions.filter((e) => e.nodeKey === "plan-ask");
    expect(again.map((e) => e.status)).toEqual(["passed", "waiting"]);
    expect((await openQuestion(run.id))!.options).toEqual(["retry", "continue", "abort"]);
  });
});

describe("an approval gate as the target of a loop that ran out", () => {
  test("asks the same three choices instead of its review, and continue routes along the reviewer's approve edge", async () => {
    const { run, deps } = await exhausted("plan-gate");
    const asked = await openQuestion(run.id);
    expect(asked).toMatchObject({ options: ["retry", "continue", "abort"], context: expect.objectContaining({ reason: "loop_exhausted", edgeKey: "plan-review->planner" }) });
    await answerQuestion(db, asked!.id, { answer: "continue", option: "continue", answeredBy: "krister" });
    await drain(deps);
    const { executions } = await inspect(db, run.id);
    // The plan gate now reviews the plan as it would after an approval.
    expect(executions.filter((e) => e.nodeKey === "plan-gate").map((e) => e.trigger?.kind)).toEqual(["exhausted", "edge"]);
    expect(executions.filter((e) => e.nodeKey === "planner")).toHaveLength(3);
    const review = await openQuestion(run.id);
    expect(review).toMatchObject({ question: "Review the plan from planner", options: ["approve", "changes", "fix"] });
  });

  test("retry at an approval gate sends the work back along the loop, not the gate's own changes edge", async () => {
    const { run, deps } = await exhausted("plan-gate");
    const asked = await openQuestion(run.id);
    await answerQuestion(db, asked!.id, { answer: "retry", option: "retry", answeredBy: "krister" });
    await drain(deps);
    const { executions, run: row } = await inspect(db, run.id);
    expect(executions.filter((e) => e.nodeKey === "planner")[3]!.trigger).toMatchObject({ kind: "edge", edgeKey: "plan-review->planner" });
    expect((row.state as { loops: Record<string, unknown> }).loops["plan-gate->planner"]).toBeUndefined();
  });

  test("a Try it gate a loop that ran out reached asks the three choices and starts no app", async () => {
    const document = planLoop("plan-gate");
    document.nodes.find((n) => n.key === "plan-gate")!.attributes.config = { mode: "try" };
    const { run } = await startRun(db, document);
    await drain(engineDeps(db, executors()));
    expect(await openQuestion(run.id)).toMatchObject({ options: ["retry", "continue", "abort"], context: expect.objectContaining({ reason: "loop_exhausted" }) });
    expect((await inspect(db, run.id)).types).not.toContain("preview.failed");
  });

  test("abort at an approval gate cancels the run", async () => {
    const { run } = await exhausted("plan-gate");
    const asked = await openQuestion(run.id);
    await answerQuestion(db, asked!.id, { answer: "abort", option: "abort", answeredBy: "krister" });
    expect((await inspect(db, run.id)).run.status).toBe("cancelled");
  });
});
