import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor, type FakeReply } from "@handoff/cli-adapter/testing";
import { eq, questions } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cliNodeExecutor } from "./executors/cli-node.ts";
import { humanGateExecutor } from "./executors/human-gate.ts";
import { answerQuestion } from "./operations.ts";
import { createRun } from "./runs.ts";
import { createOriginRepo, git } from "./testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "./testing/harness.ts";
import { done, outputs, scripted } from "./testing/scripted.ts";
import type { ExecutorRegistry } from "./types.ts";
import { GitWorktreeProvider } from "./workdir/git-worktree.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** Plan, code with a path check, test and code review; the tester sends failures back to the coder. */
const graph = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner" } },
    { key: "coder", attributes: { type: "coder", contract: { output: "coder_output", checks: [{ kind: "diff_within_paths" }] } } },
    { key: "tester", attributes: { type: "tester", config: { command: "npm test" } } },
    { key: "review", attributes: { type: "code_review" } },
  ],
  edges: [
    { key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done" } },
    { key: "coder->tester", source: "coder", target: "tester", attributes: { port: "done" } },
    { key: "tester->coder", source: "tester", target: "coder", attributes: { port: "fail" } },
    { key: "tester->review", source: "tester", target: "review", attributes: { port: "pass" } },
  ],
};

/** A coder reply that writes and commits files in the worktree before it returns its output. */
const coderWrites =
  (files: Record<string, string>, output: unknown = outputs.coderDone): FakeReply =>
  async (request, options) => {
    for (const [path, content] of Object.entries(files)) writeFileSync(join(request.cwd, path), content);
    if (Object.keys(files).length) {
      git(request.cwd, "add", "-A");
      git(request.cwd, "commit", "-qm", "work");
    }
    await options.onSessionId?.(request.session.id);
    return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: output, validated: output, costUsd: 0.01 };
  };

async function startRun(cli: FakeCliExecutor, tester: ReturnType<typeof scripted>, document: unknown = graph) {
  const origin = createOriginRepo();
  const { project, graphVersion } = await seedGraph(db, document, { localClonePath: origin });
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

const openQuestions = async (runId: string) => (await db.select().from(questions).where(eq(questions.runId, runId))).filter((q) => q.answer === null);
const coders = async (runId: string) => (await inspect(db, runId)).executions.filter((e) => e.nodeKey === "coder");

test("a lone path failure waits with a paths question naming the files", async () => {
  const cli = new FakeCliExecutor([coderWrites({ "CHANGELOG.md": "# Changelog\n", "notes.txt": "scratch\n" })]);
  const { run } = await startRun(cli, scripted(done(outputs.testsPass)));

  const [coder] = await coders(run.id);
  expect(coder!.status).toBe("waiting");
  const [question] = await openQuestions(run.id);
  expect(question).toMatchObject({ nodeExecutionId: coder!.id, options: ["allow", "send_back", "fail"], context: { reason: "paths", files: ["notes.txt"], from: "coder" } });
  expect(question!.question).toContain("notes.txt");
  const { run: row, types } = await inspect(db, run.id);
  expect(row.status).toBe("waiting");
  expect(types).toContain("human.asked");
  expect(types).not.toContain("node.failed");
});

/** Answers the run's open question, as a person on the run page would. */
async function answerOpen(runId: string, option: string, answer: string = option) {
  const [open, ...more] = await openQuestions(runId);
  expect(more).toHaveLength(0);
  await answerQuestion(db, open!.id, { answer, option, answeredBy: "krister" });
}

test("Allow for this run passes the attempt and the next attempt may change the file", async () => {
  const cli = new FakeCliExecutor([coderWrites({ "CHANGELOG.md": "# Changelog\n", "notes.txt": "scratch\n" })]);
  const { run, deps } = await startRun(cli, scripted(done(outputs.testsFail), done(outputs.testsPass)));
  cli.push(coderWrites({ "CHANGELOG.md": "# Changelog\n\n- one\n", "notes.txt": "scratch, changed\n" }), { output: outputs.approve });
  await answerOpen(run.id, "allow");
  await drain(deps);

  const attempts = await coders(run.id);
  expect(attempts.map((e) => [e.attempt, e.status])).toEqual([
    [1, "passed"],
    [2, "passed"],
  ]);
  expect(attempts[0]!.checks).toEqual([expect.objectContaining({ kind: "diff_within_paths", passed: true })]);
  expect(attempts[1]!.checks).toEqual([expect.objectContaining({ kind: "diff_within_paths", passed: true })]);
  const { run: row } = await inspect(db, run.id);
  expect(row.status).toBe("succeeded");
  expect(row.state).toMatchObject({ memory: { coder: { extraPaths: [expect.objectContaining({ path: "notes.txt", attempt: 1, by: "person" })] } } });
  // The tester ran once per coder attempt, so the allowed attempt went on to it.
  expect(cli.requests).toHaveLength(3);
});
