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
  const cli = new FakeCliExecutor([{ result: { outcome: "error_max_turns" } }, { result: { outcome: "error_max_turns" } }]);
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

test("a rate-limited CLI run is retried later instead of failing the node", async () => {
  const cli = new FakeCliExecutor([
    { result: { outcome: "error", errorMessage: "API Error: 429 rate limit exceeded" } },
    { output: plannerOut },
  ]);
  const { run } = await startRun(db, linear);
  const deps = engineDeps(db, registry(cli), { retryBackoffMs: 0 });
  await runOnce(deps);
  let planner = (await inspect(db, run.id)).executions[0]!;
  expect(planner).toMatchObject({ status: "pending", retryCount: 1 });
  await runOnce(deps);
  planner = (await inspect(db, run.id)).executions[0]!;
  expect(planner.status).toBe("passed");
});

test("an authentication failure stops the node at once with a clear message", async () => {
  const cli = new FakeCliExecutor([
    async (request, options) => {
      await options.onEvent({ type: "cli.system.api_retry", payload: { type: "system", subtype: "api_retry", attempt: 1, error: "authentication_failed" } });
      const interrupted = { outcome: "interrupted" as const, exitCode: 143, stderrTail: "" };
      if (options.signal.aborted) return interrupted;
      return new Promise((resolve) => options.signal.addEventListener("abort", () => resolve(interrupted)));
    },
  ]);
  const { run } = await startRun(db, linear);
  await runOnce(engineDeps(db, registry(cli)));
  const planner = (await inspect(db, run.id)).executions[0]!;
  expect(planner).toMatchObject({ status: "failed", error: { code: "cli_auth_failed", message: expect.stringContaining("claude setup-token") } });
});

test("running out of turns gets one resumed turn to finish and return the contract", async () => {
  const cli = new FakeCliExecutor([{ result: { outcome: "error_max_turns" } }, { output: plannerOut }]);
  const { run } = await startRun(db, linear);
  await runOnce(engineDeps(db, registry(cli)));
  const planner = (await inspect(db, run.id)).executions[0]!;
  expect(planner.status).toBe("passed");
  expect(cli.requests[1]!.session).toEqual({ mode: "resume", id: planner.id });
  expect(cli.requests[1]!.prompt).toMatch(/out of turns/i);
});

test("a node's model and effort override the worker's defaults, and nodes without them keep the defaults", async () => {
  const cli = new FakeCliExecutor([{ output: plannerOut }, { output: { status: "done", summary: "wrote it" } }]);
  const doc = structuredClone(linear) as { nodes: { key: string; attributes: Record<string, unknown> }[] };
  doc.nodes.find((n) => n.key === "coder")!.attributes.config = { model: "opus", effort: "xhigh" };
  await startRun(db, doc);
  const node = cliNodeExecutor({ cli, maxTurns: 30, timeoutMs: 60_000, model: "sonnet", effort: "medium" });
  await drain(engineDeps(db, { planner: node, coder: node, pr: stopAfterCoder } as unknown as ExecutorRegistry));
  expect(cli.requests[0]).toMatchObject({ model: "sonnet", effort: "medium" });
  expect(cli.requests[1]).toMatchObject({ model: "opus", effort: "xhigh" });
});

test("a node that allows every tool gets Claude Code's full list, still named one by one", async () => {
  const cli = new FakeCliExecutor([{ output: plannerOut }, { output: { status: "done", summary: "wrote it" } }]);
  const doc = structuredClone(linear) as { nodes: { key: string; attributes: Record<string, unknown> }[] };
  doc.nodes.find((n) => n.key === "coder")!.attributes.config = { allTools: true, allowedTools: ["Read"] };
  await startRun(db, doc);
  await drain(engineDeps(db, registry(cli)));
  const tools = cli.requests[1]!.allowedTools;
  expect(tools).toEqual(expect.arrayContaining(["Read", "Edit", "Write", "Bash", "WebFetch", "WebSearch", "Agent", "Skill"]));
  expect(tools).not.toContain("Artifact");
  expect(cli.requests[0]!.allowedTools).not.toContain("Bash");
});

test("a code review node asks for Claude Code's code-review skill on the run's branch at its level, with the Skill tool", async () => {
  const cli = new FakeCliExecutor([{ output: plannerOut }, { output: { verdict: "approve", comments: [] } }]);
  const doc = structuredClone(linear) as { nodes: { key: string; attributes: Record<string, unknown> }[] };
  const coder = doc.nodes.find((n) => n.key === "coder")!;
  coder.attributes.type = "code_review";
  coder.attributes.config = { level: "medium" };
  const { run } = await startRun(db, doc);
  await drain(engineDeps(db, { planner: cliNodeExecutor({ cli, maxTurns: 30, timeoutMs: 60_000 }), code_review: cliNodeExecutor({ cli, maxTurns: 30, timeoutMs: 60_000 }), pr: stopAfterCoder } as unknown as ExecutorRegistry));
  const request = cli.requests[1]!;
  expect(request.prompt).toContain(`skill code-review, args "medium ${run.branchName}"`);
  expect(request.allowedTools).toEqual(expect.arrayContaining(["Skill", "Bash(git diff *)"]));
  expect((await inspect(db, run.id)).executions.find((e) => e.nodeKey === "coder")?.status).toBe("passed");
});

test("the planner is asked for a short plan, and the coder for a PR title and description written for a reviewer", async () => {
  const cli = new FakeCliExecutor([{ output: plannerOut }, { output: { status: "done", summary: "wrote it" } }]);
  await startRun(db, linear);
  await drain(engineDeps(db, registry(cli)));
  expect(cli.requests[0]!.prompt).toContain("Keep plan to a few sentences on the approach; put the ordered work in steps and do not repeat the steps in plan.");
  expect(cli.requests[0]!.prompt).toContain("When the linked issues list no acceptance criteria, list in acceptance what a person can check in the running app");
  expect(cli.requests[1]!.prompt).toContain("fill pr with a title and a description of the change for a reviewer");
  expect(cli.requests[1]!.prompt).toContain("Do not restate the plan.");
});

test("the planner is told ownedPaths is the whole list of files the change may touch", async () => {
  const cli = new FakeCliExecutor([{ output: plannerOut }, { output: { status: "done", summary: "wrote it" } }]);
  await startRun(db, linear);
  await drain(engineDeps(db, registry(cli)));
  expect(cli.requests[0]!.prompt).toContain("ownedPaths is the whole list of files and directories the change may touch");
});
