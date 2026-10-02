import { afterAll, beforeEach, expect, test } from "vitest";
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { nodeCatalog } from "@handoff/core";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";
import { cliNodeExecutor } from "./cli-node.ts";
import { testerExecutor } from "./tester.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const graphWith = (command: string, config: Record<string, unknown> = {}) => {
  const doc = structuredClone(loop);
  doc.nodes.find((n) => n.key === "tester")!.attributes.config = { command, ...config };
  return doc;
};

const testerOnly = () =>
  engineDeps(db, {
    planner: scripted(done(outputs.planner, { plan: outputs.planner })),
    coder: scripted(done(outputs.coderDone)),
    tester: testerExecutor(),
    human_gate: scripted({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }),
  });

test("Tester runs the command in the workdir and records exit code and tail", async () => {
  const { run } = await startRun(db, graphWith("echo checking; echo 'broken test' >&2; exit 2"));
  await drain(
    engineDeps(db, {
      planner: scripted(done(outputs.planner, { plan: outputs.planner })),
      coder: scripted(done(outputs.coderDone)),
      tester: testerExecutor(),
      human_gate: scripted({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }),
    }),
    30,
  );
  const tester = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "tester")!;
  expect(tester.status).toBe("passed");
  expect(tester.output).toMatchObject({ passed: false, exitCode: 2 });
  expect((tester.output as { tail: string }).tail).toContain("broken test");
});

test("Tester passes the variables named in config.passEnv to its command", async () => {
  process.env.APP_TEST_DB = "postgres://localhost/app_test";
  process.env.NOT_PASSED = "hidden";
  try {
    const { run } = await startRun(db, graphWith('echo "[$APP_TEST_DB][$NOT_PASSED]"', { passEnv: ["APP_TEST_DB"] }));
    await drain(testerOnly(), 30);
    const tester = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "tester")!;
    expect((tester.output as { tail: string }).tail).toBe("[postgres://localhost/app_test][]");
  } finally {
    delete process.env.APP_TEST_DB;
    delete process.env.NOT_PASSED;
  }
});

test("Reviewer node is spawned with read-only allowed tools", async () => {
  const cli = new FakeCliExecutor([{ output: outputs.approve }]);
  const { run } = await startRun(db, graphWith("true"));
  await drain(
    engineDeps(db, {
      planner: scripted(done(outputs.planner, { plan: outputs.planner })),
      coder: scripted(done(outputs.coderDone)),
      tester: testerExecutor(),
      reviewer: cliNodeExecutor({ cli, maxTurns: 10, timeoutMs: 60_000 }),
      pr: scripted({ kind: "waiting", wait: { kind: "github_pr", key: "x" } }),
    }),
  );
  expect((await inspect(db, run.id)).executions.find((e) => e.nodeKey === "reviewer")?.status).toBe("passed");
  const tools = cli.requests[0]!.allowedTools;
  expect(tools).toEqual(nodeCatalog.reviewer.allowedTools);
  expect(tools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "Bash(git log *)", "Bash(git diff *)", "Bash(cat *)"]));
  expect(tools.some((t) => t === "Edit" || t === "Write")).toBe(false);
});
