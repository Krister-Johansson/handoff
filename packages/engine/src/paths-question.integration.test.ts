import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor, type FakeReply } from "@handoff/cli-adapter/testing";
import { eq, notifications, questions } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cliNodeExecutor } from "./executors/cli-node.ts";
import { humanGateExecutor } from "./executors/human-gate.ts";
import { answerQuestion, repairNodeExecution } from "./operations.ts";
import { createRun } from "./runs.ts";
import { runOnce } from "./scheduler/worker.ts";
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
  const told = await db.select().from(notifications).where(eq(notifications.runId, run.id));
  expect(told).toEqual([expect.objectContaining({ tone: "attention", title: expect.stringContaining("coder changed a file outside the plan"), body: "notes.txt" })]);
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

test("Send back gives the coder the files", async () => {
  const cli = new FakeCliExecutor([coderWrites({ "CHANGELOG.md": "# Changelog\n", "notes.txt": "scratch\n" })]);
  const { run, deps } = await startRun(cli, scripted(done(outputs.testsPass)));
  const undo: FakeReply = async (request, options) => {
    git(request.cwd, "rm", "-q", "notes.txt");
    git(request.cwd, "commit", "-qm", "drop notes");
    return (coderWrites({}) as Extract<FakeReply, (...args: never[]) => unknown>)(request, options);
  };
  cli.push(undo, { output: outputs.approve });
  await answerOpen(run.id, "send_back", "Scratch files do not belong in the repository.");
  await drain(deps);

  const attempts = await coders(run.id);
  expect(attempts.map((e) => [e.attempt, e.status])).toEqual([
    [1, "repaired"],
    [2, "passed"],
  ]);
  expect(attempts[0]!.error).toMatchObject({ code: "paths_outside_plan", detail: { files: ["notes.txt"] } });
  const sentBack = cli.requests[1]!;
  expect(sentBack.session.mode).toBe("new");
  expect(sentBack.systemPrompt).toContain("`notes.txt`");
  expect(sentBack.systemPrompt).toContain("Scratch files do not belong in the repository.");
  expect((await inspect(db, run.id)).run.status).toBe("succeeded");
});

test("a path failure with another failing check fails as before", async () => {
  const strict = structuredClone(graph);
  strict.nodes[1]!.attributes.contract!.checks.push({ kind: "command", command: "test -f MISSING.md", expectExitCode: 0 } as never);
  const cli = new FakeCliExecutor([coderWrites({ "CHANGELOG.md": "# Changelog\n", "notes.txt": "scratch\n" })]);
  const { run } = await startRun(cli, scripted(done(outputs.testsPass)), strict);

  const [coder] = await coders(run.id);
  expect(coder).toMatchObject({ status: "failed", error: { code: "contract_failed" } });
  expect(await openQuestions(run.id)).toHaveLength(0);
  expect((await inspect(db, run.id)).run.status).toBe("failed");
});

test("repair with allowPaths adds the paths", async () => {
  const cli = new FakeCliExecutor([coderWrites({ "CHANGELOG.md": "# Changelog\n", "notes.txt": "scratch\n" })]);
  const { run, deps } = await startRun(cli, scripted(done(outputs.testsPass)));
  await answerOpen(run.id, "fail");
  await drain(deps);
  const [failed] = await coders(run.id);

  cli.push(coderWrites({ "CHANGELOG.md": "# Changelog\n\n- one\n", "notes.txt": "kept\n" }), { output: outputs.approve });
  await repairNodeExecution(db, failed!.id, { note: "The notes file documents the release.", allowPaths: ["notes.txt"] });
  await drain(deps);

  const attempts = await coders(run.id);
  expect(attempts.map((e) => [e.attempt, e.status])).toEqual([
    [1, "repaired"],
    [2, "passed"],
  ]);
  expect(attempts[1]!.checks).toEqual([expect.objectContaining({ kind: "diff_within_paths", passed: true })]);
  expect(cli.requests[1]!.systemPrompt).toContain("`notes.txt`");
  const { run: row } = await inspect(db, run.id);
  expect(row.status).toBe("succeeded");
  expect(row.state).toMatchObject({ memory: { coder: { extraPaths: [expect.objectContaining({ path: "notes.txt", attempt: 2, by: "person" })] } } });
});

test("an answer and a concurrent step completion both keep their memory entries", async () => {
  // Two coders at once: one waits on a paths question, the other asks a question at a gate.
  const parallel = {
    attributes: { startNode: "planner" },
    nodes: [
      { key: "planner", attributes: { type: "planner" } },
      { key: "coderA", attributes: { type: "coder", contract: { output: "coder_output", checks: [{ kind: "diff_within_paths" }] } } },
      { key: "coderB", attributes: { type: "coder" } },
      { key: "ask", attributes: { type: "human_gate", config: { mode: "question" } } },
    ],
    edges: [
      { key: "planner->coderA", source: "planner", target: "coderA", attributes: { port: "done" } },
      { key: "planner->coderB", source: "planner", target: "coderB", attributes: { port: "done" } },
      { key: "coderB->ask", source: "coderB", target: "ask", attributes: { port: "needs_input" } },
      { key: "ask->coderB", source: "ask", target: "coderB", attributes: { port: "answered" } },
    ],
  };
  const origin = createOriginRepo();
  const { project, graphVersion } = await seedGraph(db, parallel, { localClonePath: origin });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
  const cli = new FakeCliExecutor([coderWrites({ "CHANGELOG.md": "# Changelog\n", "notes.txt": "scratch\n" }), { output: outputs.coderAsks }, { output: outputs.coderDone }]);
  const agent = cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 });
  const gate = humanGateExecutor({ db });
  const workdirs = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
  const executors: ExecutorRegistry = { planner: scripted(done(outputs.planner, { plan: outputs.planner })), coder: agent };
  // Another worker carries out the paths answer while the gate is between reading the run and completing.
  let meanwhile: (() => Promise<void>) | undefined;
  executors.human_gate = {
    needsWorkdir: gate.needsWorkdir,
    async execute(ctx) {
      const outcome = await gate.execute(ctx);
      const step = meanwhile;
      meanwhile = undefined;
      if (outcome.kind === "completed") await step?.();
      return outcome;
    },
  };
  const deps = engineDeps(db, executors, { workdirs });
  await drain(deps);

  const open = await openQuestions(run.id);
  const paths = open.find((q) => q.context.reason === "paths")!;
  const asked = open.find((q) => q.context.reason === "needs_input")!;
  meanwhile = async () => {
    await answerQuestion(db, paths.id, { answer: "allow", option: "allow", answeredBy: "krister" });
    expect(await runOnce(engineDeps(db, executors, { workdirs, workerId: "other-worker" }))).toBe(true);
  };
  await answerQuestion(db, asked.id, { answer: "Use ISO 8601 dates.", option: "ISO", answeredBy: "krister" });
  await drain(deps);

  expect(meanwhile).toBeUndefined();
  const { run: row } = await inspect(db, run.id);
  expect(row.state).toMatchObject({
    memory: {
      coderA: { extraPaths: [expect.objectContaining({ path: "notes.txt", by: "person" })] },
      coderB: { answers: [expect.objectContaining({ question: "ISO dates or US dates?", answer: "Use ISO 8601 dates." })] },
    },
  });
});

test("Fail the step fails the attempt with the files outside the plan", async () => {
  const cli = new FakeCliExecutor([coderWrites({ "CHANGELOG.md": "# Changelog\n", "notes.txt": "scratch\n" })]);
  const { run, deps } = await startRun(cli, scripted(done(outputs.testsPass)));
  await answerOpen(run.id, "fail");
  await drain(deps);

  const [coder, ...more] = await coders(run.id);
  expect(more).toHaveLength(0);
  expect(coder).toMatchObject({ status: "failed", error: { code: "paths_outside_plan", detail: { files: ["notes.txt"] } } });
  expect(cli.requests).toHaveLength(1);
  expect((await inspect(db, run.id)).run.status).toBe("failed");
});
