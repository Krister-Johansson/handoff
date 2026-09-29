import { afterAll, beforeEach, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { runOnce } from "../scheduler/worker.ts";
import type { ExecutorRegistry } from "../types.ts";
import { cliNodeExecutor } from "./cli-node.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const plannerOut = { plan: "write it", steps: ["write"], ownedPaths: ["CHANGELOG.md"] };
const stopAfterCoder = { needsWorkdir: false, execute: async () => ({ kind: "waiting" as const, wait: { kind: "github_pr" as const, key: "never" } }) };

function registry(cli: FakeCliExecutor): ExecutorRegistry {
  const node = cliNodeExecutor({ cli, maxTurns: 30, timeoutMs: 60_000 });
  return { planner: node, coder: node, pr: stopAfterCoder } as unknown as ExecutorRegistry;
}

test("Coder node passes with status done and records the session id", async () => {
  const cli = new FakeCliExecutor([{ output: plannerOut }, { output: { status: "done", summary: "wrote it" } }]);
  const { run } = await startRun(db, linear);
  await drain(engineDeps(db, registry(cli)));
  const { executions, run: row } = await inspect(db, run.id);
  const coder = executions.find((e) => e.nodeKey === "coder")!;
  expect(coder.status).toBe("passed");
  expect(coder.executorSessionId).toBe(coder.id);
  expect(coder.costUsd).toBe("0.010000");
  expect(row.state).toMatchObject({ plan: plannerOut, nodes: { coder: { output: { status: "done" }, sessionId: coder.id } } });
});

test("the Coder request carries the context packet, owned paths, catalog tools and a new session keyed by the execution", async () => {
  const cli = new FakeCliExecutor([{ output: plannerOut }, { output: { status: "done", summary: "wrote it" } }]);
  const { run } = await startRun(db, linear);
  await drain(engineDeps(db, registry(cli)));
  const coderId = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "coder")!.id;
  const request = cli.requests[1]!;
  expect(request.session).toEqual({ mode: "new", id: coderId, name: expect.stringContaining("coder-1") });
  expect(request.systemPrompt).toContain("# Task");
  expect(request.systemPrompt).toContain("Add a CHANGELOG.md");
  expect(request.systemPrompt).toContain("Only change files under: CHANGELOG.md");
  expect(request.allowedTools).toContain("Edit");
  expect(cli.requests[0]!.allowedTools).not.toContain("Edit");
});

test("Coder node with status needs_input passes the contract without checks", async () => {
  const cli = new FakeCliExecutor([{ output: plannerOut }, { output: { status: "needs_input", summary: "?", question: { text: "ISO dates?" } } }]);
  const { run } = await startRun(db, linear);
  await drain(engineDeps(db, registry(cli)));
  const coder = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "coder")!;
  expect(coder.status).toBe("passed");
  expect(coder.output).toMatchObject({ status: "needs_input" });
});

test("a CLI error fails the node with the CLI outcome as the error code", async () => {
  const cli = new FakeCliExecutor([{ result: { outcome: "error_max_turns" } }]);
  const { run } = await startRun(db, linear);
  await drain(engineDeps(db, registry(cli)));
  const planner = (await inspect(db, run.id)).executions[0]!;
  expect(planner).toMatchObject({ status: "failed", error: { code: "cli_error_max_turns" } });
});

test("a reclaimed CLI node resumes its recorded session instead of starting a new one", async () => {
  const cli = new FakeCliExecutor([{ result: { outcome: "interrupted" } }, { output: plannerOut }]);
  const { run } = await startRun(db, linear);
  const deps = engineDeps(db, registry(cli));
  await runOnce(deps);
  await runOnce(deps);
  const planner = (await inspect(db, run.id)).executions[0]!;
  expect(cli.requests[0]!.session.mode).toBe("new");
  expect(cli.requests[1]!.session).toEqual({ mode: "resume", id: planner.id });
});
