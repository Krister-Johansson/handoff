import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import planReview from "@handoff/core/fixtures/plan-review.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { edgeTraversals, eq, nodeExecutions } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { runOnce, type EngineDeps, type ExecutorRegistry, type NodeExecutor } from "@handoff/engine";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { getRunDetail } from "./queries";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("a passed execution that took a loop edge reads as sent back, one that went on as passed", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: planReview });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build it" });
  const sentBack = await seedExecution(db, run.id, { nodeKey: "plan-review", nodeType: "reviewer", status: "passed" });
  const wentOn = await seedExecution(db, run.id, { nodeKey: "plan-review", nodeType: "reviewer", attempt: 2, status: "passed" });
  await db.insert(edgeTraversals).values([
    { runId: run.id, edgeKey: "plan-review->planner", fromExecutionId: sentBack.id, toNodeKey: "planner" },
    { runId: run.id, edgeKey: "plan-review->approval", fromExecutionId: wentOn.id, toNodeKey: "approval" },
  ]);
  const detail = await getRunDetail(db, run.id);
  const status = (id: string) => detail!.executions.find((e) => e.id === id)?.status;
  expect(status(sentBack.id)).toBe("sent_back");
  expect(status(wentOn.id)).toBe("passed");
  expect((await db.select().from(nodeExecutions).where(eq(nodeExecutions.id, sentBack.id)))[0]?.status).toBe("passed");
});

/** An executor that completes with each output in turn, the last one repeating. */
function scripted(...outputs: unknown[]): NodeExecutor {
  let calls = 0;
  return { needsWorkdir: false, execute: async () => ({ kind: "completed", output: outputs[Math.min(calls++, outputs.length - 1)] }) };
}

test("a step the tester sent back reads sent back", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: loop });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build it" });
  const plan = { plan: "p", steps: ["s"], ownedPaths: ["CHANGELOG.md"] };
  const executors: ExecutorRegistry = {
    planner: { needsWorkdir: false, execute: async () => ({ kind: "completed", output: plan, statePatch: { plan } }) },
    coder: scripted({ status: "done", summary: "done" }),
    tester: scripted({ passed: false, command: "npm test", exitCode: 1, tail: "FAIL" }, { passed: true, command: "npm test", exitCode: 0, tail: "ok" }),
    // The run stops at review: it waits there for a person.
    reviewer: { needsWorkdir: false, execute: async () => ({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }) },
  };
  const deps: EngineDeps = {
    db,
    workerId: "test-worker",
    caps: { cli: 1, shell: 4, github: 4, human: 100, function: 8 },
    leaseMs: 60_000,
    executors,
    workdirs: { acquire: async () => ({ path: tmpdir(), baseSha: "0".repeat(40) }), release: async () => {} },
    stagingRoot: mkdtempSync(join(tmpdir(), "handoff-staging-")),
  };
  for (let i = 0; i < 20 && (await runOnce(deps)); i++);
  const detail = await getRunDetail(db, run.id);
  const testers = detail!.executions.filter((e) => e.nodeKey === "tester");
  expect(testers.map((e) => e.status)).toEqual(["sent_back", "passed"]);
});
