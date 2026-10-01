import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { resolveExhaustedLoop, stuckLoop } from "../operations.ts";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** A reviewer that may send the work back once, with no gate for when that runs out. */
const graph = {
  attributes: { startNode: "coder" },
  nodes: [
    { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
    { key: "reviewer", attributes: { type: "reviewer", x: 300, y: 0 } },
    { key: "tester", attributes: { type: "tester", config: { command: "true" }, x: 600, y: 0 } },
  ],
  edges: [
    { key: "coder->reviewer", source: "coder", target: "reviewer", attributes: { port: "done" } },
    { key: "reviewer->coder", source: "reviewer", target: "coder", attributes: { port: "changes", maxAttempts: 1 } },
    { key: "reviewer->tester", source: "reviewer", target: "tester", attributes: { port: "approve" } },
  ],
};

const executors = () => ({ coder: scripted(done(outputs.coderDone)), reviewer: scripted(done(outputs.requestChanges)), tester: scripted(done(outputs.testsPass)) });

async function stuck() {
  const { run } = await startRun(db, graph, "Add a CHANGELOG.md");
  const deps = engineDeps(db, executors());
  await drain(deps);
  return { run, deps };
}

test("a loop that runs out stops the run as stuck, saying where", async () => {
  const { run } = await stuck();
  const { run: row, executions } = await inspect(db, run.id);
  expect(row.status).toBe("failed");
  expect(executions.map((e) => e.nodeKey)).toEqual(["coder", "reviewer", "coder", "reviewer"]);
  expect(await stuckLoop(db, run.id)).toMatchObject({ nodeKey: "reviewer", edgeKey: "reviewer->coder", attempts: 1 });
});

test("another round sends the work back once more with a fresh loop", async () => {
  const { run, deps } = await stuck();
  await resolveExhaustedLoop(db, run.id, "retry");
  expect((await inspect(db, run.id)).run.status).toBe("running");
  await drain(deps);
  const { executions } = await inspect(db, run.id);
  expect(executions.filter((e) => e.nodeKey === "coder").map((e) => e.trigger)).toEqual([
    expect.objectContaining({ kind: "start" }),
    expect.objectContaining({ kind: "edge", edgeKey: "reviewer->coder" }),
    expect.objectContaining({ kind: "edge", edgeKey: "reviewer->coder" }),
  ]);
});

test("going on as if approved follows the step's forward edges, and the run can finish", async () => {
  const { run, deps } = await stuck();
  await resolveExhaustedLoop(db, run.id, "continue");
  await drain(deps);
  const { run: row, executions, types } = await inspect(db, run.id);
  expect(executions.at(-1)).toMatchObject({ nodeKey: "tester", status: "passed", trigger: expect.objectContaining({ kind: "edge", edgeKey: "reviewer->tester" }) });
  expect(row.status).toBe("succeeded");
  expect(types).toContain("loop.resolved");
  expect(await stuckLoop(db, run.id)).toBeUndefined();
});

test("stopping cancels the run, and a run that is not stuck cannot be resolved", async () => {
  const { run } = await stuck();
  await resolveExhaustedLoop(db, run.id, "stop");
  expect((await inspect(db, run.id)).run.status).toBe("cancelled");
  await expect(resolveExhaustedLoop(db, run.id, "retry")).rejects.toThrow(/not stopped by a loop/);
});
