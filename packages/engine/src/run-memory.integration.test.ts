import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor, type FakeReply } from "@handoff/cli-adapter/testing";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cliNodeExecutor } from "./executors/cli-node.ts";
import { humanGateExecutor } from "./executors/human-gate.ts";
import { repairNodeExecution } from "./operations.ts";
import { createRun } from "./runs.ts";
import { createOriginRepo, git } from "./testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "./testing/harness.ts";
import { done, outputs, scripted } from "./testing/scripted.ts";
import type { ExecutorRegistry } from "./types.ts";
import { GitWorktreeProvider } from "./workdir/git-worktree.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** Plan, code, test and code review, with a question gate for the coder and the tester sending failures back. */
const graph = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner" } },
    { key: "coder", attributes: { type: "coder", contract: { output: "coder_output", checks: [{ kind: "diff_within_paths" }] } } },
    { key: "ask", attributes: { type: "human_gate", config: { mode: "question" } } },
    { key: "tester", attributes: { type: "tester", config: { command: "npm test" } } },
    { key: "review", attributes: { type: "code_review" } },
  ],
  edges: [
    { key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done" } },
    { key: "coder->tester", source: "coder", target: "tester", attributes: { port: "done" } },
    { key: "coder->ask", source: "coder", target: "ask", attributes: { port: "needs_input" } },
    { key: "ask->coder", source: "ask", target: "coder", attributes: { port: "answered" } },
    { key: "tester->coder", source: "tester", target: "coder", attributes: { port: "fail" } },
    { key: "tester->review", source: "tester", target: "review", attributes: { port: "pass" } },
  ],
};

/** A coder reply that writes and commits files in the worktree before it returns its output. */
const coderWrites =
  (files: Record<string, string>, output: unknown): FakeReply =>
  async (request, options) => {
    for (const [path, content] of Object.entries(files)) writeFileSync(join(request.cwd, path), content);
    if (Object.keys(files).length) {
      git(request.cwd, "add", "-A");
      git(request.cwd, "commit", "-qm", "work");
    }
    await options.onSessionId?.(request.session.id);
    return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: output, validated: output, costUsd: 0.01 };
  };

async function startRun(cli: FakeCliExecutor, tester: ReturnType<typeof scripted>) {
  const origin = createOriginRepo();
  const { project, graphVersion } = await seedGraph(db, graph, { localClonePath: origin });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
  const agent = cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 });
  const executors: ExecutorRegistry = {
    planner: scripted(done(outputs.planner, { plan: outputs.planner })),
    coder: agent,
    code_review: agent,
    tester,
    human_gate: humanGateExecutor({ db }),
  };
  const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });
  await drain(deps);
  return { run, deps, cli };
}

const coders = async (runId: string) => (await inspect(db, runId)).executions.filter((e) => e.nodeKey === "coder");

test("a path declared in extraPaths by attempt 1 passes diff_within_paths in attempt 3 without being declared again", async () => {
  const cli = new FakeCliExecutor([
    coderWrites(
      { "CHANGELOG.md": "# Changelog\n", "pnpm-workspace.yaml": "allowBuilds: {}\n" },
      { ...outputs.coderDone, extraPaths: [{ path: "pnpm-workspace.yaml", reason: "pnpm reads build approvals only from this file" }] },
    ),
    coderWrites({ "CHANGELOG.md": "# Changelog\n\n- one\n" }, outputs.coderDone),
    coderWrites({ "CHANGELOG.md": "# Changelog\n\n- one\n- two\n" }, outputs.coderDone),
    { output: outputs.approve },
  ]);
  const { run } = await startRun(cli, scripted(done(outputs.testsFail), done(outputs.testsFail), done(outputs.testsPass)));
  const attempts = await coders(run.id);
  expect(attempts.map((e) => [e.attempt, e.status])).toEqual([
    [1, "passed"],
    [2, "passed"],
    [3, "passed"],
  ]);
  expect(attempts[2]!.checks).toEqual([expect.objectContaining({ kind: "diff_within_paths", passed: true })]);
  expect((await inspect(db, run.id)).run.status).toBe("succeeded");
});

test("a repair note reaches every later attempt of the node, not only the repaired one", async () => {
  const note = "Use the date helper in src/dates.ts.";
  const cli = new FakeCliExecutor([{ output: { status: "failed", summary: "gave up" } }]);
  const { run, deps } = await startRun(cli, scripted(done(outputs.testsFail), done(outputs.testsPass)));
  const [failed] = await coders(run.id);
  expect(failed!.status).toBe("failed");

  cli.push(coderWrites({ "CHANGELOG.md": "# Changelog\n" }, outputs.coderDone), coderWrites({ "CHANGELOG.md": "# Changelog\n\n- one\n" }, outputs.coderDone), { output: outputs.approve });
  await repairNodeExecution(db, failed!.id, { note });
  await drain(deps);

  const attempts = await coders(run.id);
  expect(attempts.map((e) => [e.attempt, e.status])).toEqual([
    [1, "repaired"],
    [2, "passed"],
    [3, "passed"],
  ]);
  const [, repaired, later] = cli.requests;
  expect(repaired!.systemPrompt).toContain(note);
  expect(later!.session.mode).toBe("new");
  expect(later!.systemPrompt).toContain(note);
});
