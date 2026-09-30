import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDb, seedExecution, seedRun, truncateAll } from "@handoff/db/testing";
import { getExecutionDetail } from "./queries.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("getExecutionDetail returns the output, checks, error and trigger of one execution", async () => {
  const { run } = await seedRun(db, { status: "running" });
  const execution = await seedExecution(db, run.id, {
    nodeKey: "tester",
    nodeType: "tester",
    executorKind: "shell",
    status: "failed",
    output: { passed: false, command: "npm test", exitCode: 1, tail: "1 failing" },
    checks: [{ kind: "tests_green", passed: false, detail: "exit 1", durationMs: 12 }],
    error: { code: "checks_failed", message: "tests_green failed" },
    trigger: { kind: "edge", edgeKey: "coder->tester", from: "coder" },
    costUsd: "0.120000",
  });
  const detail = await getExecutionDetail(db, run.id, execution.id);
  expect(detail).toMatchObject({
    id: execution.id,
    nodeKey: "tester",
    nodeType: "tester",
    attempt: 1,
    status: "failed",
    output: { passed: false, tail: "1 failing" },
    checks: [{ kind: "tests_green", passed: false }],
    error: { code: "checks_failed" },
    trigger: { kind: "edge", from: "coder" },
    costUsd: "0.120000",
  });
});

test("getExecutionDetail does not return another run's execution", async () => {
  const { run } = await seedRun(db, { status: "running" });
  const { run: other } = await seedRun(db, { status: "running" });
  const execution = await seedExecution(db, other.id);
  expect(await getExecutionDetail(db, run.id, execution.id)).toBeUndefined();
});
