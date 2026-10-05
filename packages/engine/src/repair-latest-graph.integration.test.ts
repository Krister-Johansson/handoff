import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, graphs, graphVersions } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { repairNodeExecution } from "./operations.ts";
import { drain, engineDeps, inspect, startRun } from "./testing/harness.ts";
import { done, outputs, scripted } from "./testing/scripted.ts";
import type { ExecutorRegistry } from "./types.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** Plan, then code; the planner's contract runs `check` in the worktree. */
const planThenCode = (check: string, coderKey = "coder") => ({
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", contract: { output: "planner_output", checks: [{ kind: "command", command: check }] } } },
    { key: coderKey, attributes: { type: "coder" } },
  ],
  edges: [{ key: `planner->${coderKey}`, source: "planner", target: coderKey, attributes: { port: "done" } }],
});

const executors = (): ExecutorRegistry => ({
  planner: { ...scripted(done(outputs.planner, { plan: outputs.planner })), needsWorkdir: true },
  coder: scripted(done(outputs.coderDone)),
});

/** Stores the document as the graph's next version, as saving the graph does. */
async function saveVersion(graphId: string, document: unknown) {
  const [graph] = await db.select().from(graphs).where(eq(graphs.id, graphId));
  const version = graph!.latestVersion + 1;
  const [row] = await db.insert(graphVersions).values({ graphId, version, document: document as Record<string, unknown> }).returning();
  await db.update(graphs).set({ latestVersion: version }).where(eq(graphs.id, graphId));
  return row!;
}

/** A run whose planner failed its contract check on version 1. */
async function failedPlanner() {
  const started = await startRun(db, planThenCode("exit 1"));
  const deps = engineDeps(db, executors());
  await drain(deps);
  const { run, executions } = await inspect(db, started.run.id);
  expect(run.status).toBe("failed");
  return { ...started, deps, failed: executions.find((e) => e.nodeKey === "planner")! };
}

test("repair on the latest graph moves the run to the newest version and re-runs the failed node with its new config", async () => {
  const { run, graphVersion, deps, failed } = await failedPlanner();
  const fixed = await saveVersion(graphVersion.graphId, planThenCode("exit 0"));

  const created = await repairNodeExecution(db, failed.id, { latestGraph: true });
  expect(created).toMatchObject({ nodeKey: "planner", attempt: 2 });
  await drain(deps);

  const after = await inspect(db, run.id);
  expect(after.run).toMatchObject({ status: "succeeded", graphVersionId: fixed.id });
  expect(after.executions.map((e) => [e.nodeKey, e.attempt, e.status])).toEqual([
    ["planner", 1, "repaired"],
    ["planner", 2, "passed"],
    ["coder", 1, "passed"],
  ]);
  const upgraded = after.events.find((e) => e.type === "run.graph_upgraded");
  expect(upgraded?.payload).toEqual({ from: { version: 1, graphVersionId: graphVersion.id }, to: { version: 2, graphVersionId: fixed.id } });
  expect(after.types.indexOf("run.graph_upgraded")).toBeLessThan(after.types.indexOf("node.repair_requested"));
});

test("the repaired attempt takes its node's type from the latest version", async () => {
  const { graphVersion, failed } = await failedPlanner();
  const retyped = planThenCode("exit 0");
  await saveVersion(graphVersion.graphId, {
    ...retyped,
    nodes: [{ key: "planner", attributes: { type: "tester", config: { command: "npm test" } } }, retyped.nodes[1]!],
    edges: [{ ...retyped.edges[0]!, attributes: { port: "pass" } }],
  });

  const created = await repairNodeExecution(db, failed.id, { latestGraph: true });
  expect(created).toMatchObject({ nodeKey: "planner", nodeType: "tester", executorKind: "shell", upgrade: { from: { version: 1 }, to: { version: 2 } } });
});

test("repair without the option re-runs the failed node on the version the run pinned", async () => {
  const { run, graphVersion, deps, failed } = await failedPlanner();
  await saveVersion(graphVersion.graphId, planThenCode("exit 0"));

  await repairNodeExecution(db, failed.id, {});
  await drain(deps);

  const after = await inspect(db, run.id);
  expect(after.run).toMatchObject({ status: "failed", graphVersionId: graphVersion.id });
  expect(after.types).not.toContain("run.graph_upgraded");
});

/** Repairs on the latest graph and expects the refusal, with the run, its steps and its events as they were. */
async function refused(runId: string, executionId: string, message: string | RegExp) {
  const before = await inspect(db, runId);
  await expect(repairNodeExecution(db, executionId, { latestGraph: true, note: "with the fix" })).rejects.toThrow(message);
  const after = await inspect(db, runId);
  expect(after.run).toEqual(before.run);
  expect(after.executions).toEqual(before.executions);
  expect(after.types).toEqual(before.types);
}

test("repair on the latest graph refuses, changing nothing, when the run is already on the latest version", async () => {
  const { run, failed } = await failedPlanner();
  await refused(run.id, failed.id, "the run is already on version 1 of graph g, its latest");
});

test("repair on the latest graph refuses, changing nothing, when the latest version has no node with the failed node's key", async () => {
  const { run, graphVersion, failed } = await failedPlanner();
  const renamed = planThenCode("exit 0");
  renamed.nodes[0]!.key = "plan";
  renamed.edges[0] = { ...renamed.edges[0]!, key: "plan->coder", source: "plan" };
  await saveVersion(graphVersion.graphId, { ...renamed, attributes: { startNode: "plan" } });
  await refused(run.id, failed.id, "version 2 of graph g has no node planner");
});

/** Code and review; the reviewer sends the work back over `loopKey` while rounds remain, and approves into the PR. */
const codeAndReview = (loopKey: string, maxAttempts: number) => ({
  attributes: { startNode: "coder" },
  nodes: [
    { key: "coder", attributes: { type: "coder" } },
    { key: "reviewer", attributes: { type: "reviewer" } },
    { key: "pr", attributes: { type: "pr" } },
  ],
  edges: [
    { key: "coder->reviewer", source: "coder", target: "reviewer", attributes: { condition: { eq: ["node.output.status", "done"] } } },
    { key: loopKey, source: "reviewer", target: "coder", attributes: { loop: true, maxAttempts, condition: { eq: ["node.output.verdict", "request_changes"] } } },
    { key: "reviewer->pr", source: "reviewer", target: "pr", attributes: { condition: { eq: ["node.output.verdict", "approve"] } } },
  ],
});

test("a loop edge the latest version renames counts its rounds afresh, and the old counter stays in run state", async () => {
  const started = await startRun(db, codeAndReview("reviewer->coder", 2));
  const deps = engineDeps(db, {
    coder: scripted(done(outputs.coderDone), { kind: "failed", error: { code: "boom", message: "it broke" } }, done(outputs.coderDone)),
    reviewer: scripted(done(outputs.requestChanges), done(outputs.requestChanges), done(outputs.approve)),
    pr: scripted(done(outputs.prGreen)),
  });
  await drain(deps);
  const failed = (await inspect(db, started.run.id)).executions.find((e) => e.status === "failed")!;
  expect(failed).toMatchObject({ nodeKey: "coder", attempt: 2 });
  await saveVersion(started.graphVersion.graphId, codeAndReview("send-back", 1));

  await repairNodeExecution(db, failed.id, { latestGraph: true });
  await drain(deps);

  const { run, executions } = await inspect(db, started.run.id);
  expect(run.status).toBe("succeeded");
  expect(executions.filter((e) => e.nodeKey === "reviewer")).toHaveLength(3);
  expect(run.state).toMatchObject({ loops: { "reviewer->coder": { attempts: 1 }, "send-back": { attempts: 1 } } });
});

/** Two branches meet at the PR: the tester's directly, the coder's through the reviewer. */
const twoBranches = (testerEdge: string) => ({
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner" } },
    { key: "tester", attributes: { type: "tester" } },
    { key: "coder", attributes: { type: "coder" } },
    { key: "reviewer", attributes: { type: "reviewer" } },
    { key: "pr", attributes: { type: "pr" } },
  ],
  edges: [
    { key: "planner->tester", source: "planner", target: "tester", attributes: {} },
    { key: "planner->coder", source: "planner", target: "coder", attributes: {} },
    { key: "coder->reviewer", source: "coder", target: "reviewer", attributes: {} },
    { key: testerEdge, source: "tester", target: "pr", attributes: {} },
    { key: "reviewer->pr", source: "reviewer", target: "pr", attributes: {} },
  ],
});

test("repair on the latest graph refuses, changing nothing, when a join in the run waits on an edge the latest version does not have", async () => {
  const started = await startRun(db, twoBranches("tester->pr"));
  await drain(
    engineDeps(db, {
      planner: scripted(done(outputs.planner, { plan: outputs.planner })),
      tester: scripted(done(outputs.testsPass)),
      coder: scripted(done(outputs.coderDone)),
      reviewer: scripted({ kind: "failed", error: { code: "boom", message: "it broke" } }),
    }),
  );
  const { run, executions } = await inspect(db, started.run.id);
  expect(run.status).toBe("failed");
  await saveVersion(started.graphVersion.graphId, twoBranches("tests->pr"));
  await refused(run.id, executions.find((e) => e.status === "failed")!.id, "version 2 of graph g has no edge tester->pr, which pr waits on");
});

test("repair on the latest graph refuses, changing nothing, when the latest version does not compile", async () => {
  const { run, graphVersion, failed } = await failedPlanner();
  await saveVersion(graphVersion.graphId, { ...planThenCode("exit 0"), attributes: { startNode: "nowhere" } });
  await refused(run.id, failed.id, /^version 2 of graph g does not compile: /);
});
