import { afterAll, beforeEach, describe, expect, test } from "vitest";
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import loopTemplate from "@handoff/core/templates/loop.graph.json" with { type: "json" };
import planTemplate from "@handoff/core/templates/plan-review.graph.json" with { type: "json" };
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { finishExecutor, startExecutor } from "../executors/flow.ts";
import { cancelRun, repairNodeExecution } from "../operations.ts";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";
import type { ExecutorRegistry } from "../types.ts";
import { runOnce } from "../scheduler/worker.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

function registry(overrides: Partial<ExecutorRegistry> = {}): ExecutorRegistry {
  return {
    planner: scripted(done(outputs.planner, { plan: outputs.planner })),
    coder: scripted(done(outputs.coderDone)),
    tester: scripted(done(outputs.testsPass)),
    reviewer: scripted(done(outputs.approve)),
    pr: scripted(done(outputs.prGreen, { prNumber: 1, feedback: outputs.prGreen.feedback })),
    merge: scripted(done({ merged: true })),
    human_gate: scripted({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }),
    ...overrides,
  };
}

describe("loop edges", () => {
  test("the loop graph runs straight through when every node passes", async () => {
    const { run } = await startRun(db, loop);
    await drain(engineDeps(db, registry()));
    const { run: row, executions } = await inspect(db, run.id);
    expect(executions.map((e) => e.nodeKey)).toEqual(["planner", "coder", "tester", "reviewer", "pr", "merge"]);
    expect(row.status).toBe("succeeded");
  });

  test("a loop edge creates attempt 2 of the target node with the failure feedback in its context", async () => {
    const { run } = await startRun(db, loop);
    await drain(engineDeps(db, registry({ tester: scripted(done(outputs.testsFail), done(outputs.testsPass)) })));
    const { run: row, executions } = await inspect(db, run.id);
    const coders = executions.filter((e) => e.nodeKey === "coder");
    expect(coders.map((e) => e.attempt)).toEqual([1, 2]);
    expect(coders[1]!.trigger).toMatchObject({ kind: "edge", edgeKey: "tester->coder", from: "tester" });
    const packet = coders[1]!.contextPacket as { priorAttempt?: { failedChecks: { logTail?: string }[] } };
    expect(packet.priorAttempt?.failedChecks[0]?.logTail).toContain("expected ISO date");
    expect(row.state).toMatchObject({ loops: { "tester->coder": { attempts: 1 } } });
    expect(row.status).toBe("succeeded");
  });

  test("review comments and CI failures reach the Coder on retry", async () => {
    const { run } = await startRun(db, loop);
    const pr = scripted(done(outputs.prRed, { prNumber: 1, feedback: outputs.prRed.feedback }), done(outputs.prGreen, { prNumber: 1, feedback: outputs.prGreen.feedback }));
    await drain(engineDeps(db, registry({ reviewer: scripted(done(outputs.requestChanges), done(outputs.approve)), pr })));
    const coders = (await inspect(db, run.id)).executions.filter((e) => e.nodeKey === "coder");
    expect(coders).toHaveLength(3);
    const afterReview = coders[1]!.contextPacket as { priorAttempt?: { reviewComments: { body: string }[] } };
    expect(afterReview.priorAttempt?.reviewComments.map((c) => c.body)).toEqual(["Use ISO dates"]);
    const afterCi = coders[2]!.contextPacket as { priorAttempt?: { failedChecks: { kind: string; logTail?: string }[] } };
    expect(afterCi.priorAttempt?.failedChecks[0]).toMatchObject({ kind: "ci: test", logTail: "Error: date format" });
  });

  test("a loop edge stops after maxAttempts and routes to the Human gate", async () => {
    const { run } = await startRun(db, loop);
    await drain(engineDeps(db, registry({ tester: scripted(done(outputs.testsFail)) })));
    const { run: row, executions, types } = await inspect(db, run.id);
    expect(executions.filter((e) => e.nodeKey === "coder")).toHaveLength(4);
    const gate = executions.find((e) => e.nodeKey === "gate")!;
    expect(gate.trigger).toMatchObject({ kind: "exhausted", edgeKey: "tester->coder" });
    expect(gate.status).toBe("waiting");
    expect(row.status).toBe("waiting");
    expect(types).toContain("edge.exhausted");
  });
});

describe("fan-in joins", () => {
  const fan = {
    attributes: { startNode: "start" },
    nodes: ["start", "a", "b", "join"].map((key) => ({ key, attributes: { type: "function" } as Record<string, unknown> })),
    edges: [
      { key: "start->a", source: "start", target: "a", attributes: {} },
      { key: "start->b", source: "start", target: "b", attributes: {} },
      { key: "a->join", source: "a", target: "join", attributes: {} },
      { key: "b->join", source: "b", target: "join", attributes: {} },
    ],
  };

  test("a fan-in node runs once after all upstream nodes pass", async () => {
    const { run } = await startRun(db, fan);
    await drain(engineDeps(db, { function: scripted(done({ ok: true })) }));
    const { run: row, executions, types } = await inspect(db, run.id);
    expect(executions.filter((e) => e.nodeKey === "join")).toHaveLength(1);
    expect(executions.every((e) => e.status === "passed")).toBe(true);
    expect(row.status).toBe("succeeded");
    expect(types.filter((t) => t === "join.arrived")).toHaveLength(2);
    expect(types).toContain("join.fired");
  });

  test("a join in any mode runs on the first arrival and absorbs the rest", async () => {
    const doc = structuredClone(fan);
    doc.nodes[3]!.attributes.config = { join: "any" };
    const { run } = await startRun(db, doc);
    await drain(engineDeps(db, { function: scripted(done({ ok: true })) }));
    const { run: row, executions } = await inspect(db, run.id);
    expect(executions.filter((e) => e.nodeKey === "join")).toHaveLength(1);
    expect(row.status).toBe("succeeded");
  });

  // The demo's skipped port and the Try it gate's approve both lead to the PR node, and only one of them is taken.
  test.each([
    ["loop", loopTemplate],
    ["plan", planTemplate],
  ])("in the %s template a demo skipped for a change with no UI goes on to the PR node", async (_, template) => {
    const { run } = await startRun(db, template);
    const executors = registry({
      start: startExecutor(),
      finish: finishExecutor(),
      human_gate: scripted(done({ option: "approve", answer: "Approve", answeredBy: "dashboard", answeredAt: "2026-10-05T00:00:00Z" })),
      demo: scripted(done({ summary: "Skipped", skipped: true, reason: "the change touches no UI path", shots: [] })),
    });
    await drain(engineDeps(db, executors));
    const { run: row, executions } = await inspect(db, run.id);
    expect(executions.filter((e) => e.nodeKey === "try")).toEqual([]);
    expect(executions.filter((e) => e.nodeKey === "pr").map((e) => e.status)).toEqual(["passed"]);
    expect(row.status).toBe("succeeded");
  });

  test("a join in any mode runs again when the work comes back to it in a later round", async () => {
    const { run } = await startRun(db, loopTemplate);
    const executors = registry({
      start: startExecutor(),
      finish: finishExecutor(),
      demo: scripted(done({ summary: "Skipped", skipped: true, reason: "the change touches no UI path", shots: [] })),
      // The pull request's CI fails once: the work goes back to the coder and through the demo to the PR node again.
      pr: scripted(done(outputs.prRed, { prNumber: 1, feedback: outputs.prRed.feedback }), done(outputs.prGreen, { prNumber: 1, feedback: outputs.prGreen.feedback })),
    });
    await drain(engineDeps(db, executors));
    const { run: row, executions } = await inspect(db, run.id);
    const prs = executions.filter((e) => e.nodeKey === "pr");
    expect(prs.map((e) => e.status)).toEqual(["passed", "passed"]);
    expect(prs[1]!.trigger).toMatchObject({ kind: "edge", edgeKey: "demo->pr" });
    expect(row.status).toBe("succeeded");
  });
});

describe("repair and cancel", () => {
  test("repairing a failed node re-runs it in place and keeps upstream results", async () => {
    const { run } = await startRun(db, loop);
    const tester = scripted({ kind: "failed", error: { code: "boom", message: "runner crashed" } }, done(outputs.testsPass));
    const deps = engineDeps(db, registry({ tester }));
    await drain(deps);
    let snapshot = await inspect(db, run.id);
    expect(snapshot.run.status).toBe("failed");
    const failed = snapshot.executions.find((e) => e.nodeKey === "tester")!;

    await repairNodeExecution(db, failed.id, { note: "runner fixed" });
    await drain(deps);
    snapshot = await inspect(db, run.id);
    const testers = snapshot.executions.filter((e) => e.nodeKey === "tester");
    expect(testers.map((e) => e.status)).toEqual(["repaired", "passed"]);
    expect(testers[1]).toMatchObject({ repairNote: "runner fixed", trigger: { kind: "repair" } });
    expect(snapshot.executions.filter((e) => e.nodeKey === "planner")).toHaveLength(1);
    expect(snapshot.run.status).toBe("succeeded");
  });

  test("repairing something that has not failed is refused", async () => {
    const { run } = await startRun(db, loop);
    const [pending] = (await inspect(db, run.id)).executions;
    await expect(repairNodeExecution(db, pending!.id, {})).rejects.toThrow(/only failed/);
  });

  test("cancel stops the running node and marks the run cancelled", async () => {
    const { run } = await startRun(db, loop);
    const planner = scripted(async (ctx) => {
      await cancelRun(db, run.id);
      await new Promise<void>((resolve) => {
        if (ctx.signal.aborted) resolve();
        ctx.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { kind: "interrupted" };
    });
    await runOnce(engineDeps(db, registry({ planner }), { leaseMs: 90 }));
    const { run: row, executions, types } = await inspect(db, run.id);
    expect(row.status).toBe("cancelled");
    expect(executions[0]).toMatchObject({ status: "failed", error: { code: "cancelled" } });
    expect(types).toContain("run.cancelled");
  });
});
