import { afterAll, beforeEach, describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { wakeByKey } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import type { ExecutorOutcome, ExecutorRegistry, NodeExecutor } from "../types.ts";
import { runOnce } from "./worker.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const completes = (output: unknown, statePatch: Record<string, unknown> = {}): NodeExecutor => ({
  needsWorkdir: false,
  execute: async () => ({ kind: "completed", output, statePatch }),
});

const plannerOut = { plan: "write it", steps: ["write"], ownedPaths: ["CHANGELOG.md"] };
const coderOut = { status: "done", summary: "wrote it" };
const prOut = {
  prNumber: 7,
  prUrl: "https://github.com/octo/sample/pull/7",
  headSha: "abc",
  feedback: { ci: { status: "success", failedJobs: [] }, review: { decision: "approved", comments: [], unresolvedThreads: 0 }, updatedAt: "now" },
};

function registry(overrides: Partial<ExecutorRegistry> = {}): ExecutorRegistry {
  return {
    planner: completes(plannerOut, { plan: plannerOut }),
    coder: completes(coderOut),
    pr: completes(prOut, { prNumber: 7 }),
    merge: completes({ merged: true }),
    ...overrides,
  } as ExecutorRegistry;
}

describe("scheduler", () => {
  test("a queued run creates a pending execution for the start node", async () => {
    const { run } = await startRun(db, linear);
    const { run: row, executions, types } = await inspect(db, run.id);
    expect(row.status).toBe("queued");
    expect(executions.map((e) => [e.nodeKey, e.status, e.attempt, e.executorKind])).toEqual([["planner", "pending", 1, "cli"]]);
    expect(types).toEqual(["run.created", "node.created"]);
  });

  test("a passed execution creates a pending execution for the next node with the run state merged", async () => {
    const { run } = await startRun(db, linear);
    const deps = engineDeps(db, registry());
    expect(await runOnce(deps)).toBe(true);
    const { run: row, executions, types } = await inspect(db, run.id);
    expect(executions.map((e) => [e.nodeKey, e.status])).toEqual([
      ["planner", "passed"],
      ["coder", "pending"],
    ]);
    expect(row.status).toBe("running");
    expect(row.state).toMatchObject({ plan: plannerOut, nodes: { planner: { output: plannerOut, attempt: 1 } } });
    expect(types).toEqual(["run.created", "node.created", "run.started", "node.claimed", "node.passed", "edge.taken", "node.created"]);
  });

  test("a linear run finishes when the last node passes", async () => {
    const { run } = await startRun(db, linear);
    await drain(engineDeps(db, registry()));
    const { run: row, executions, types } = await inspect(db, run.id);
    expect(executions.map((e) => e.status)).toEqual(["passed", "passed", "passed", "passed"]);
    expect(row.status).toBe("succeeded");
    expect(row.finishedAt).not.toBeNull();
    expect(types.at(-1)).toBe("run.succeeded");
  });

  test("a node whose out-edges all fail their conditions fails the run with no_route", async () => {
    const { run } = await startRun(db, linear);
    await drain(engineDeps(db, registry({ coder: completes({ status: "needs_input", summary: "?", question: { text: "Which format?" } }) })));
    const { run: row, executions, events } = await inspect(db, run.id);
    expect(executions.map((e) => [e.nodeKey, e.status])).toEqual([
      ["planner", "passed"],
      ["coder", "passed"],
    ]);
    expect(row.status).toBe("failed");
    expect(events.at(-1)).toMatchObject({ type: "run.failed", payload: { nodeKey: "coder", reason: "no_route" } });
  });

  test("a finished run releases its worktree", async () => {
    const { run } = await startRun(db, linear);
    const released: string[] = [];
    const workdirs = { acquire: async () => ({ path: "/tmp/x", baseSha: "0" }), release: async (spec: { runId: string }) => void released.push(spec.runId) };
    await drain(engineDeps(db, registry(), { workdirs }));
    expect(released).toEqual([run.id]);
  });

  test("an executor crash is stored and reported with secrets redacted", async () => {
    const { run } = await startRun(db, linear);
    const crashing: NodeExecutor = {
      needsWorkdir: false,
      execute: async () => {
        throw new Error("Command failed: git -c http.extraheader=AUTHORIZATION: basic c2VjcmV0LXRva2Vu clone");
      },
    };
    await drain(engineDeps(db, registry({ planner: crashing })));
    const { executions } = await inspect(db, run.id);
    expect(executions[0]?.error).toMatchObject({ code: "executor_crashed", message: expect.stringContaining("AUTHORIZATION: basic [redacted]") });
    const stored = JSON.stringify(await db.$client.query("select payload from events where run_id = $1", [run.id]).then((r) => r.rows));
    expect(stored).not.toContain("c2VjcmV0");
    expect(JSON.stringify(executions)).not.toContain("c2VjcmV0");
  });

  test("a failed execution with no failed edge marks the run failed and creates no successor", async () => {
    const { run } = await startRun(db, linear);
    const failing: NodeExecutor = { needsWorkdir: false, execute: async () => ({ kind: "failed", error: { code: "boom", message: "it broke" } }) };
    await drain(engineDeps(db, registry({ planner: failing })));
    const { run: row, executions, types } = await inspect(db, run.id);
    expect(executions.map((e) => [e.nodeKey, e.status])).toEqual([["planner", "failed"]]);
    expect(executions[0]?.error).toMatchObject({ code: "boom" });
    expect(row.status).toBe("failed");
    expect(types.at(-1)).toBe("run.failed");
  });

  test("an output that breaks the node contract fails the execution", async () => {
    const { run } = await startRun(db, linear);
    await drain(engineDeps(db, registry({ planner: completes({ nope: true }) })));
    const { executions } = await inspect(db, run.id);
    expect(executions[0]).toMatchObject({ status: "failed", error: { code: "contract_failed" } });
  });

  test("a waiting execution resumes when woken by its key and then passes", async () => {
    const { run } = await startRun(db, linear);
    let calls = 0;
    const pr: NodeExecutor = {
      needsWorkdir: false,
      execute: async (ctx): Promise<ExecutorOutcome> => {
        calls++;
        if (calls === 1) return { kind: "waiting", wait: { kind: "github_pr", key: "gh:pr:1:7" } };
        expect(ctx.execution.wakeReason).toBe("webhook");
        return { kind: "completed", output: prOut, statePatch: { prNumber: 7 } };
      },
    };
    const deps = engineDeps(db, registry({ pr }));
    await drain(deps);
    let snapshot = await inspect(db, run.id);
    expect(snapshot.run.status).toBe("waiting");
    expect(snapshot.executions.find((e) => e.nodeKey === "pr")?.status).toBe("waiting");

    await wakeByKey(db, "gh:pr:1:7", { reason: "webhook" });
    await drain(deps);
    snapshot = await inspect(db, run.id);
    expect(snapshot.run.status).toBe("succeeded");
    expect(snapshot.types).toContain("node.waiting");
  });

  test("a wake that arrives while the execution is running returns it to pending on yield", async () => {
    const { run } = await startRun(db, linear);
    let calls = 0;
    const pr: NodeExecutor = {
      needsWorkdir: false,
      execute: async (ctx): Promise<ExecutorOutcome> => {
        calls++;
        if (calls === 1) {
          await ctx.registerWait("gh:pr:1:7");
          await wakeByKey(db, "gh:pr:1:7", { reason: "webhook" });
          return { kind: "waiting", wait: { kind: "github_pr", key: "gh:pr:1:7" } };
        }
        return { kind: "completed", output: prOut };
      },
    };
    await drain(engineDeps(db, registry({ pr })));
    expect((await inspect(db, run.id)).run.status).toBe("succeeded");
    expect(calls).toBe(2);
  });

  test("an interrupted execution is released for reclaim and runs again", async () => {
    const { run } = await startRun(db, linear);
    let calls = 0;
    const planner: NodeExecutor = {
      needsWorkdir: false,
      execute: async () => (++calls === 1 ? { kind: "interrupted" } : { kind: "completed", output: plannerOut, statePatch: { plan: plannerOut } }),
    };
    await drain(engineDeps(db, registry({ planner })));
    const { executions, run: row } = await inspect(db, run.id);
    expect(executions[0]).toMatchObject({ nodeKey: "planner", status: "passed", interruptCount: 1 });
    expect(row.status).toBe("succeeded");
  });

  test("events emitted by an executor are stored against its execution", async () => {
    const { run } = await startRun(db, linear);
    const planner: NodeExecutor = {
      needsWorkdir: false,
      execute: async (ctx) => {
        ctx.emit("cli.system.init", { session_id: "s" });
        ctx.emit("cli.assistant", { text: "hi" });
        return { kind: "completed", output: plannerOut };
      },
    };
    await runOnce(engineDeps(db, registry({ planner })));
    const { events, executions } = await inspect(db, run.id);
    const cli = events.filter((e) => e.type.startsWith("cli."));
    expect(cli.map((e) => e.type)).toEqual(["cli.system.init", "cli.assistant"]);
    expect(cli.every((e) => e.nodeExecutionId === executions[0]?.id)).toBe(true);
  });

  test("a lost lease discards the executor's result", async () => {
    const { run } = await startRun(db, linear);
    const planner: NodeExecutor = {
      needsWorkdir: false,
      execute: async (ctx) => {
        await db.$client.query("update node_executions set lease_owner = 'someone-else' where id = $1", [ctx.execution.id]);
        return { kind: "completed", output: plannerOut };
      },
    };
    await runOnce(engineDeps(db, registry({ planner })));
    const { executions } = await inspect(db, run.id);
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe("running");
  });
});

describe("automatic retries", () => {
  test("a retryable failure re-queues the same execution after a backoff and runs it again", async () => {
    const { run } = await startRun(db, linear);
    let calls = 0;
    const planner: NodeExecutor = {
      needsWorkdir: false,
      execute: async () =>
        ++calls === 1
          ? { kind: "failed", error: { code: "cli_rate_limited", message: "usage limit reached" }, retryable: true, retryAfterMs: 0 }
          : { kind: "completed", output: plannerOut, statePatch: { plan: plannerOut } },
    };
    await drain(engineDeps(db, registry({ planner })));
    const { run: row, executions, types } = await inspect(db, run.id);
    const planners = executions.filter((e) => e.nodeKey === "planner");
    expect(planners).toHaveLength(1);
    expect(planners[0]).toMatchObject({ status: "passed", retryCount: 1 });
    expect(types).toContain("node.retrying");
    expect(row.status).toBe("succeeded");
  });

  test("a retryable failure waits for its backoff before running again", async () => {
    const { run } = await startRun(db, linear);
    const planner: NodeExecutor = {
      needsWorkdir: false,
      execute: async () => ({ kind: "failed", error: { code: "cli_rate_limited", message: "limit" }, retryable: true, retryAfterMs: 60_000 }),
    };
    await drain(engineDeps(db, registry({ planner })));
    const [planner1] = (await inspect(db, run.id)).executions;
    expect(planner1).toMatchObject({ status: "pending", retryCount: 1 });
    expect(planner1!.runnableAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  test("a retryable failure fails the node once maxRetries is used", async () => {
    const { run } = await startRun(db, linear);
    const planner: NodeExecutor = {
      needsWorkdir: false,
      execute: async () => ({ kind: "failed", error: { code: "cli_rate_limited", message: "limit" }, retryable: true, retryAfterMs: 0 }),
    };
    await drain(engineDeps(db, registry({ planner }), { maxRetries: 2 }));
    const { run: row, executions } = await inspect(db, run.id);
    expect(executions[0]).toMatchObject({ status: "failed", retryCount: 2, error: { code: "cli_rate_limited" } });
    expect(row.status).toBe("failed");
  });
});

test("node.passed events carry the node's cost and duration", async () => {
  const { run } = await startRun(db, linear);
  const planner: NodeExecutor = {
    needsWorkdir: false,
    execute: async () => ({ kind: "completed", output: plannerOut, statePatch: { plan: plannerOut }, cost: { usd: 0.1234 } }),
  };
  await runOnce(engineDeps(db, registry({ planner })));
  const passed = (await inspect(db, run.id)).events.find((e) => e.type === "node.passed")!;
  expect(passed.payload).toMatchObject({ nodeKey: "planner", costUsd: 0.1234, durationMs: expect.any(Number) });
});
