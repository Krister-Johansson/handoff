import { afterAll, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { parseUnifiedDiff, type DiffFile } from "@handoff/core";
import { eq, questions } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { answerQuestion } from "../operations.ts";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";
import { cliNodeExecutor } from "./cli-node.ts";
import { humanGateExecutor } from "./human-gate.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const diff = parseUnifiedDiff(
  ["diff --git a/src/a.ts b/src/a.ts", `index ${"a".repeat(40)}..${"b".repeat(40)} 100644`, "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,2 +1,3 @@", " export {};", "+const a = 1;", "+const b = 2;", " // end"].join(
    "\n",
  ),
);

/** coder -> gate; the gate's changes go back to the coder, approve goes on to a second coder step. */
const coderGraph = {
  attributes: { startNode: "coder" },
  nodes: [
    { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
    { key: "gate", attributes: { type: "human_gate", x: 300, y: 0 } },
    { key: "docs", attributes: { type: "coder", x: 600, y: 0 } },
  ],
  edges: [
    { key: "coder->gate", source: "coder", target: "gate", attributes: { port: "done" } },
    { key: "gate->coder", source: "gate", target: "coder", attributes: { port: "changes" } },
    { key: "gate->docs", source: "gate", target: "docs", attributes: { port: "approve" } },
  ],
};

async function atGate(files: DiffFile[] | undefined = diff) {
  const cli = new FakeCliExecutor([{ output: { status: "done", summary: "Added two constants." } }]);
  const { run } = await startRun(db, coderGraph, "Add constants");
  const agent = cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 });
  const deps = engineDeps(db, { coder: agent, human_gate: humanGateExecutor({ db, branchDiff: async () => files }) });
  await drain(deps);
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  return { cli, deps, question: question! };
}

type CodeReview = { from: string; kind: string; markdown: string; files?: DiffFile[]; backTo?: string };
const reviewIn = (q: { context: unknown }) => (q.context as { review: CodeReview }).review;

test("a gate after a coder asks for a review of the code, with the branch's files", async () => {
  const { question } = await atGate();
  expect(question.question).toBe("Review the code from coder");
  const review = reviewIn(question);
  expect(review).toMatchObject({ from: "coder", kind: "code" });
  expect(review.markdown).toContain("Added two constants.");
  expect(review.files?.map((f) => [f.path, f.additions, f.whole])).toEqual([["src/a.ts", 2, true]]);
});

test("without a diff the gate shows the coder's summary as before", async () => {
  const { question } = await atGate([]);
  expect(reviewIn(question)).toMatchObject({ kind: "change" });
  expect(reviewIn(question).files).toBeUndefined();
});

test("a gate after a tester shows the test log without terminal colour codes", async () => {
  const graph = {
    attributes: { startNode: "coder" },
    nodes: [
      { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
      { key: "tester", attributes: { type: "tester", config: { command: "npm test" }, x: 300, y: 0 } },
      { key: "gate", attributes: { type: "human_gate", x: 600, y: 0 } },
    ],
    edges: [
      { key: "coder->tester", source: "coder", target: "tester", attributes: { port: "done" } },
      { key: "tester->gate", source: "tester", target: "gate", attributes: { port: "pass" } },
      { key: "gate->coder", source: "gate", target: "coder", attributes: { port: "changes" } },
    ],
  };
  const { run } = await startRun(db, graph, "Add constants");
  const tail = "\u001b[32m✓\u001b[39m src/a.test.ts \u001b[2m(1 test)\u001b[22m";
  await drain(
    engineDeps(db, {
      coder: scripted(done(outputs.coderDone)),
      tester: scripted(done({ passed: true, command: "npm test", exitCode: 0, tail })),
      human_gate: humanGateExecutor({ db, branchDiff: async () => diff }),
    }),
  );
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  const review = reviewIn(question!);
  expect(question!.question).toBe("Review the code from tester");
  expect(review.kind).toBe("code");
  // Comments go back where the gate's changes edge leads, not to the tester that sent the work.
  expect(review.backTo).toBe("coder");
  expect(review.markdown).toContain("✓ src/a.test.ts (1 test)");
  expect(review.markdown).not.toContain("\u001b");
});

test("asking for changes sends each line comment back to the coder with its place and code", async () => {
  const { cli, deps, question } = await atGate();
  cli.push({ output: { status: "done", summary: "Renamed." } });
  await answerQuestion(db, question.id, {
    answer: "Two things.",
    option: "changes",
    comments: [{ path: "src/a.ts", line: 2, endLine: 3, side: "new", quote: "const a = 1;\nconst b = 2;", body: "Use one object." }],
    answeredBy: "krister",
  });
  await drain(deps);
  const [answered] = await db.select().from(questions).where(eq(questions.id, question.id));
  expect(answered?.comments).toEqual([{ path: "src/a.ts", line: 2, endLine: 3, side: "new", quote: "const a = 1;\nconst b = 2;", body: "Use one object." }]);
  const retry = cli.requests[1]!;
  expect(retry.systemPrompt).toContain('- src/a.ts:2-3 - person on "const a = 1; const b = 2;": Use one object.');
  expect(retry.systemPrompt).toContain("changes: Two things.");
});

test("line comments with an approval become decisions later steps keep to", async () => {
  const { cli, deps, question } = await atGate();
  cli.push({ output: outputs.coderDone });
  await answerQuestion(db, question.id, { answer: "Approved.", option: "approve", comments: [{ path: "src/a.ts", line: 2, quote: "const a = 1;", body: "Keep this name." }], answeredBy: "krister" });
  await drain(deps);
  const docs = cli.requests[1]!;
  expect(docs.systemPrompt).toContain("# Decisions from the person reviewing this run");
  expect(docs.systemPrompt).toContain('- src/a.ts:2 on "const a = 1;": Keep this name.');
});

test("approve after fixes sends the comments back, then lets the fixed work through without asking again", async () => {
  const { cli, deps, question } = await atGate();
  cli.push({ output: { status: "done", summary: "Fixed." } }, { output: outputs.coderDone });
  await answerQuestion(db, question.id, { answer: "Fix the name, then go on.", option: "fix", comments: [{ path: "src/a.ts", line: 2, body: "Rename." }], answeredBy: "krister" });
  await drain(deps);

  // The coder got the comment, and the gate let its fix through to the next step.
  expect(cli.requests[1]!.systemPrompt).toContain("- src/a.ts:2 - person: Rename.");
  expect(cli.requests[2]!.prompt).toBeDefined();
  const { executions, events } = await inspect(db, question.runId);
  expect(executions.filter((e) => e.nodeKey === "gate").map((e) => e.status)).toEqual(["passed", "passed"]);
  expect(executions.find((e) => e.nodeKey === "docs")?.status).toBe("passed");
  expect(await db.select().from(questions).where(eq(questions.runId, question.runId))).toHaveLength(1);
  expect(events.find((e) => e.type === "human.auto_approved")?.payload).toMatchObject({ approvedBy: "krister" });
});

test("approval after fixes routes like changes, approves the next pass, and is then used up", async () => {
  const { cli, deps, question } = await atGate();
  cli.push({ output: { status: "done", summary: "Fixed." } }, { output: outputs.coderDone });
  await answerQuestion(db, question.id, { answer: "Fix it.", option: "fix", comments: [{ body: "Rename." }], answeredBy: "krister" });
  await drain(deps);
  const { run, executions } = await inspect(db, question.runId);
  const gates = executions.filter((e) => e.nodeKey === "gate");
  expect(gates[0]!.output).toMatchObject({ option: "changes", afterFixes: true, approved: false });
  expect(gates[1]!.output).toMatchObject({ option: "approve", approved: true, answer: "Approved after fixes.", answeredBy: "krister" });
  expect((run.state as { approvedAfterFixes?: Record<string, unknown> }).approvedAfterFixes).toEqual({});
});
