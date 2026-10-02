import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { eq, notifications, questions, wakeByToken } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { answerQuestion } from "../operations.ts";
import { createRun } from "../runs.ts";
import { createOriginRepo, git, landOnMain } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph, startRun } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";
import type { ExecutorRegistry, NodeExecutor } from "../types.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { cliNodeExecutor } from "./cli-node.ts";
import { humanGateExecutor } from "./human-gate.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

function registry(cli: FakeCliExecutor, overrides: Partial<ExecutorRegistry> = {}): ExecutorRegistry {
  const agent = cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 });
  return {
    planner: agent,
    coder: agent,
    tester: scripted(done(outputs.testsPass)),
    reviewer: scripted(done(outputs.approve)),
    pr: scripted({ kind: "waiting", wait: { kind: "github_pr", key: "stop-here" } }),
    human_gate: humanGateExecutor({ db }),
    ...overrides,
  };
}

async function askingRun(asks: unknown = outputs.coderAsks) {
  const cli = new FakeCliExecutor([{ output: outputs.planner }, { output: asks }]);
  const { run } = await startRun(db, loop);
  const deps = engineDeps(db, registry(cli));
  await drain(deps);
  return { cli, run, deps };
}

test("Human gate stores the Coder's question and yields waiting on its token", async () => {
  const { run } = await askingRun();
  const { executions, run: row, types } = await inspect(db, run.id);
  const gate = executions.find((e) => e.nodeKey === "gate")!;
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  expect(question).toMatchObject({ question: "ISO dates or US dates?", options: ["ISO", "US"], nodeExecutionId: gate.id, answer: null });
  expect(gate).toMatchObject({ status: "waiting", waitKind: "human", waitToken: question!.id });
  expect(row.status).toBe("waiting");
  expect(types).toContain("human.asked");
});

test("Human gate keeps the summary the Coder wrote for its question, next to the full text", async () => {
  const text = "The changelog has dates in two formats. ISO sorts, US matches the README. ISO dates or US dates?";
  const { run } = await askingRun({ ...outputs.coderAsks, question: { text, summary: "ISO or US dates in the changelog?", options: ["ISO", "US"] } });
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  expect(question).toMatchObject({ question: text, context: { reason: "needs_input", summary: "ISO or US dates in the changelog?" } });
});

const told = async (runId: string) => (await db.select().from(notifications).where(eq(notifications.runId, runId))).map(({ tone, title, body, href }) => ({ tone, title, body, href }));

test("a gate that asks a Coder's question notifies with the question's summary, or the question cut short, and links to the run", async () => {
  const text = `${"The changelog has dates in two formats, and the README uses a third. ".repeat(3)}ISO dates or US dates?`;
  const summarized = await askingRun({ ...outputs.coderAsks, question: { text, summary: "ISO or US dates in the changelog?" } });
  expect(await told(summarized.run.id)).toEqual([
    { tone: "attention", title: expect.stringMatching(/^p-\w+: gate asks a question$/), body: "ISO or US dates in the changelog?", href: `/projects/${summarized.run.projectId}/runs/${summarized.run.id}` },
  ]);

  const plain = await askingRun({ ...outputs.coderAsks, question: { text } });
  const body = (await told(plain.run.id))[0]!.body;
  expect(body).toMatch(/^The changelog has dates in two formats.*…$/);
  expect(body.length).toBeLessThanOrEqual(140);
});

test("a gate that runs again for the same step keeps its one question and its one notification", async () => {
  const { run, deps } = await askingRun();
  const gate = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "gate")!;
  // The worker woke the gate without an answer, as after a restart.
  await wakeByToken(db, gate.waitToken!, { reason: "restart" });
  await drain(deps);
  expect(await db.select().from(questions).where(eq(questions.runId, run.id))).toHaveLength(1);
  expect(await told(run.id)).toHaveLength(1);
});

test("Coder resumed after a needs_input answer passes --resume with the recorded session id and the answer in the prompt", async () => {
  const { cli, run, deps } = await askingRun();
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  const firstCoder = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "coder")!;
  cli.push({ output: outputs.coderDone });

  await answerQuestion(db, question!.id, { answer: "Use ISO 8601 dates.", option: "ISO", answeredBy: "krister" });
  await drain(deps);

  const { executions, run: row, types } = await inspect(db, run.id);
  expect(executions.find((e) => e.nodeKey === "gate")!.status).toBe("passed");
  const resumed = cli.requests[2]!;
  expect(resumed.session).toEqual({ mode: "resume", id: firstCoder.id });
  expect(resumed.prompt).toContain("Use ISO 8601 dates.");
  expect(row.state).toMatchObject({ human: { gate: { answer: "Use ISO 8601 dates.", option: "ISO", answeredBy: "krister" } } });
  expect(executions.filter((e) => e.nodeKey === "coder").map((e) => e.status)).toEqual(["passed", "passed"]);
  expect(types).toContain("human.answered");
});

test("answering a question twice is refused", async () => {
  const { run } = await askingRun();
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  await answerQuestion(db, question!.id, { answer: "ISO", answeredBy: "a" });
  await expect(answerQuestion(db, question!.id, { answer: "US", answeredBy: "b" })).rejects.toThrow(/already answered/);
});

describe("approvals hold until the change changes", () => {
  /** coder -> gate -> pr; the gate's changes and the PR's fix go back to the coder. */
  const reviewGraph = {
    attributes: { startNode: "coder" },
    nodes: [
      { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
      { key: "gate", attributes: { type: "human_gate", x: 300, y: 0 } },
      { key: "pr", attributes: { type: "pr", x: 600, y: 0 } },
    ],
    edges: [
      { key: "coder->gate", source: "coder", target: "gate", attributes: { port: "done" } },
      { key: "gate->coder", source: "gate", target: "coder", attributes: { port: "changes" } },
      { key: "gate->pr", source: "gate", target: "pr", attributes: { port: "approve" } },
      { key: "pr->coder", source: "pr", target: "coder", attributes: { port: "fix" } },
    ],
  };

  /** The first attempt changes the notes; a later one only merges main, as a coder resolving a conflict would. */
  const coder: NodeExecutor = {
    needsWorkdir: true,
    execute: async (ctx) => {
      const path = ctx.workdir!.path;
      if (ctx.execution.attempt === 1) {
        writeFileSync(join(path, "notes.txt"), "one\ntwo, from the run\nthree\n");
        git(path, "commit", "-qam", "Change the notes");
      } else {
        git(path, "fetch", "-q", "origin");
        git(path, "merge", "-q", "--no-edit", "origin/main");
      }
      return { kind: "completed", output: { status: "done", summary: "Changed the notes." } };
    },
  };

  test("an approval gate passes without a question when the fingerprint matches its last approval", async () => {
    const origin = createOriginRepo({ "notes.txt": "one\ntwo\nthree\n" });
    // The first PR attempt finds main moved on and sends the work back, as a conflict elsewhere would.
    const pr = scripted(
      () => {
        landOnMain(origin, "LICENSE", "MIT\n");
        return done({ sync: "conflict", conflict: { base: "main", baseSha: "0".repeat(40), files: ["LICENSE"] } });
      },
      { kind: "waiting", wait: { kind: "github_pr", key: "stop-here" } },
    );
    const { project, graphVersion } = await seedGraph(db, reviewGraph, { localClonePath: origin });
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Change the notes" });
    const workdirs = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
    const deps = engineDeps(db, { coder, pr, human_gate: humanGateExecutor({ db }) }, { workdirs });
    await drain(deps);
    const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
    await answerQuestion(db, question!.id, { answer: "Approved.", option: "approve", answeredBy: "krister" });
    await drain(deps);

    const { executions, events } = await inspect(db, run.id);
    expect(await db.select().from(questions).where(eq(questions.runId, run.id))).toHaveLength(1);
    expect(executions.map((e) => [e.nodeKey, e.attempt, e.status])).toEqual([
      ["coder", 1, "passed"],
      ["gate", 1, "passed"],
      ["pr", 1, "passed"],
      ["coder", 2, "passed"],
      ["gate", 2, "passed"],
      ["pr", 2, "waiting"],
    ]);
    expect(executions.find((e) => e.nodeKey === "gate" && e.attempt === 2)!.output).toMatchObject({ option: "approve", approved: true, answeredBy: "krister" });
    const held = events.find((e) => e.type === "approval.held");
    expect((held?.payload as { message?: string } | undefined)?.message).toMatch(/^Unchanged since your approval at .+; only main was merged in$/);
  });
});

test("a gate reached by loop exhaustion asks whether to retry and offers abort", async () => {
  const cli = new FakeCliExecutor([{ output: outputs.planner }, ...Array.from({ length: 4 }, () => ({ output: outputs.coderDone }))]);
  const { run } = await startRun(db, loop);
  await drain(engineDeps(db, registry(cli, { tester: scripted(done(outputs.testsFail)) })));
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  expect(question!.question).toMatch(/tester->coder/);
  expect(question!.options).toEqual(["retry", "abort"]);
});
