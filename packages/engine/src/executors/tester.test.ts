import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { ExecutorContext } from "../types.ts";
import { testerExecutor } from "./tester.ts";

/** What the tester reads of its context: its node's config, the run, the worktree and the signal. */
function contextFor(config: Record<string, unknown>) {
  const path = mkdtempSync(join(tmpdir(), "handoff-tester-"));
  const events: { type: string; payload: unknown }[] = [];
  const ctx = {
    node: { key: "tests", type: "tester", config },
    run: { id: "5a998648-6452-44ed-8da6-7c2c518a3b7d" },
    workdir: { path, baseSha: "0".repeat(40) },
    signal: new AbortController().signal,
    emit: (type: string, payload: unknown) => events.push({ type, payload }),
  } as unknown as ExecutorContext;
  return { ctx, events };
}

const FLAKY = "if [ -f .tried ]; then echo '1 passed'; else touch .tried; echo 'FAIL flaky.test.ts' >&2; exit 1; fi";

test("a failing command passes on its retry with a note", async () => {
  const { ctx } = contextFor({ command: FLAKY });
  const outcome = await testerExecutor().execute(ctx);
  expect(outcome).toMatchObject({ kind: "completed", output: { passed: true, exitCode: 0, tail: "1 passed" } });
  const { note } = (outcome as { output: { note?: string } }).output;
  expect(note).toContain("The first run failed");
  expect(note).toContain("FAIL flaky.test.ts");
});

test("a command that is not found fails as an environment failure and does not go to the coder", async () => {
  const { ctx, events } = contextFor({ command: "vitest-not-installed run" });
  const outcome = await testerExecutor().execute(ctx);
  // A failed step, not a completed one with passed: false, which would leave through fail to the coder.
  expect(outcome).toMatchObject({ kind: "failed", error: { code: "tester_environment", message: expect.stringContaining("vitest-not-installed") } });
  expect((outcome as { error: { detail: { tail: string } } }).error.detail.tail).toContain("not found");
  // Running it again would not find it either.
  expect(events.filter((e) => e.type === "shell.started")).toHaveLength(1);
});

test("an environment failure names the command, its exit code and its last output lines", async () => {
  const { ctx } = contextFor({ command: "echo \"setup step $((1 + 1))\"; vitest-not-installed run" });
  const outcome = await testerExecutor().execute(ctx);
  expect(outcome).toMatchObject({ kind: "failed", error: { code: "tester_environment", detail: { exitCode: 127 } } });
  const { message } = (outcome as { error: { message: string } }).error;
  expect(message).toContain("vitest-not-installed run");
  expect(message).toContain("exit 127");
  // Output, not the command line echoed back: the command says $((1 + 1)), its output says 2.
  expect(message).toContain("setup step 2");
  expect(message).toMatch(/vitest-not-installed: (command )?not found/);
});

test("a failing test is a result for the coder, not an environment failure", async () => {
  const { ctx } = contextFor({ command: "echo 'FAIL src/a.test.ts > adds'; echo 'Error: Cannot find module ./b'; exit 1", retries: 0 });
  expect(await testerExecutor().execute(ctx)).toMatchObject({ kind: "completed", output: { passed: false, exitCode: 1 } });
});

test("a runner that stops on a missing env variable goes to the coder with its output", async () => {
  // What vitest printed when a global setup threw before any test ran: exit 1, no failing test named.
  const vitest = [
    "echo 'No test files found, exiting with code 1'",
    "echo 'Unhandled Error' >&2",
    "echo 'Error: DATABASE_URL_TEST is not set. The unit and e2e tests migrate and use the test database.' >&2",
    "exit 1",
  ].join("; ");
  const { ctx } = contextFor({ command: vitest, retries: 0 });
  const outcome = await testerExecutor().execute(ctx);
  expect(outcome).toMatchObject({ kind: "completed", output: { passed: false, exitCode: 1 } });
  expect((outcome as { output: { tail: string } }).output.tail).toContain("DATABASE_URL_TEST is not set");
});

test("the shell's not-found line is an environment failure when a script exits with another code", async () => {
  const { ctx } = contextFor({ command: "vitest-not-installed run || exit 1" });
  expect(await testerExecutor().execute(ctx)).toMatchObject({ kind: "failed", error: { code: "tester_environment", detail: { exitCode: 1 } } });
});
