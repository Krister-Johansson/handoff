import { afterAll, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { and, eq, isNull, nodeExecutions, questions, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { cliNodeExecutor } from "./executors/cli-node.ts";
import { humanGateExecutor } from "./executors/human-gate.ts";
import { answerQuestion, splitRun } from "./operations.ts";
import { createRun } from "./runs.ts";
import { drain, engineDeps, inspect, seedGraph } from "./testing/harness.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** planner -> plan gate, with the gate's changes back to the planner. */
const graph = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
    { key: "gate", attributes: { type: "human_gate", x: 300, y: 0 } },
  ],
  edges: [
    { key: "planner->gate", source: "planner", target: "gate", attributes: { port: "done" } },
    { key: "gate->planner", source: "gate", target: "planner", attributes: { port: "changes", input: "feedback" } },
  ],
};

const issue = { number: 12, title: "Add a board", url: "https://github.com/octo/sample/issues/12", body: "Show todos as a board." };

/** Another run of the project, kept from running in the test: its status, its plan's paths and its pull request. */
async function otherRun(projectId: string, graphVersionId: string, input: { task: string; status: "waiting" | "failed"; ownedPaths?: string[]; prNumber?: number; issues?: (typeof issue)[] }) {
  const run = await createRun(db, { projectId, graphVersionId, task: input.task, ...(input.issues ? { issues: input.issues } : {}) });
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, run.id));
  const plan = input.ownedPaths ? { plan: { plan: "p", steps: ["s"], ownedPaths: input.ownedPaths } } : {};
  await db
    .update(runs)
    .set({ status: input.status, state: { ...run.state, ...plan }, ...(input.prNumber ? { prNumber: input.prNumber } : {}) })
    .where(eq(runs.id, run.id));
  return run;
}

test("every planner attempt reads its issues again with their comments, is told the other active runs and open handoff PRs, and the plan gate lists the overlaps", async () => {
  const github = new FakeGitHub();
  github.issues.set(12, { ...issue, body: "Show todos as a board, with a column per status.", state: "open" });
  github.comment(12, "krister", "Keep the list view too.");
  const { project, graphVersion } = await seedGraph(db, graph);
  const tags = await otherRun(project.id, graphVersion.id, {
    task: "Add tags",
    status: "waiting",
    ownedPaths: ["src/board.tsx", "src/tags.ts"],
    issues: [{ number: 7, title: "Add tags", url: "https://github.com/octo/sample/issues/7", body: "" }],
  });
  const pr = await github.createPr({ owner: "octo", name: "sample" }, { head: "handoff/dark-mode", base: "main", title: "Dark mode", body: "" });
  github.prs.get(pr.number)!.files = ["src/theme.css", "src/list.tsx"];
  const dark = await otherRun(project.id, graphVersion.id, { task: "Dark mode", status: "failed", prNumber: pr.number });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a board", issues: [issue] });

  const plan = { plan: "Add a board view.", steps: ["Add the board"], ownedPaths: ["src/board.tsx", "src/list.tsx"] };
  const cli = new FakeCliExecutor([{ output: plan }, { output: plan }]);
  const deps = engineDeps(db, { planner: cliNodeExecutor({ cli, maxTurns: 30, timeoutMs: 60_000 }), human_gate: humanGateExecutor({ db }) }, { github });
  await drain(deps);

  const prompt = cli.requests[0]!.systemPrompt;
  expect(prompt).toContain("Show todos as a board, with a column per status.");
  expect(prompt).toContain("Keep the list view too.");
  expect(prompt).toContain(`\`${tags.branchName}\` (#7 Add tags) owns \`src/board.tsx\`, \`src/tags.ts\``);
  expect(prompt).toContain(`#${pr.number} on \`${dark.branchName}\` changes \`src/theme.css\`, \`src/list.tsx\``);
  expect((await inspect(db, run.id)).run.state).toMatchObject({
    issues: [{ number: 12, body: "Show todos as a board, with a column per status.", comments: [{ author: "krister", body: "Keep the list view too." }] }],
  });

  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));
  expect((question!.context as { overlaps?: unknown }).overlaps).toEqual([
    { runId: tags.id, task: "Add tags", branch: tags.branchName, issues: [{ number: 7, title: "Add tags" }], paths: ["src/board.tsx"] },
    { runId: dark.id, task: "Dark mode", branch: dark.branchName, issues: [], paths: ["src/list.tsx"], pr: pr.number },
  ]);

  // The issue changed while the person reviewed the plan: the next attempt reads it again.
  github.issues.get(12)!.body = "A board with drag and drop.";
  await answerQuestion(db, question!.id, { answer: "Plan it again.", option: "changes", answeredBy: "krister" });
  await drain(deps);
  expect(cli.requests[1]!.systemPrompt).toContain("A board with drag and drop.");
});

test("after Split as proposed the planner plans the first part again, told that the later parts are other issues", async () => {
  const parts = [
    { title: "Show todos as a board", body: "A board with a column per status.", ownedPaths: ["src/board.tsx"] },
    { title: "Drag todos between columns", body: "Drag a card to change its status.", ownedPaths: ["src/drag.ts"] },
  ];
  const split = { status: "split", plan: "Two changes.", steps: [], ownedPaths: [], parts };
  const part1 = { plan: "Add the board.", steps: ["Add the board"], ownedPaths: ["src/board.tsx"] };
  const cli = new FakeCliExecutor([{ output: split }, { output: part1 }]);
  const { project, graphVersion } = await seedGraph(db, graph);
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a board with drag and drop" });
  const deps = engineDeps(db, { planner: cliNodeExecutor({ cli, maxTurns: 30, timeoutMs: 60_000 }), human_gate: humanGateExecutor({ db }) });
  await drain(deps);
  const [question] = await db.select().from(questions).where(eq(questions.runId, run.id));

  await splitRun(db, question!.id, { answeredBy: "krister", issues: [{ number: 13, title: "Drag todos between columns", url: "https://github.com/octo/sample/issues/13" }] });
  await drain(deps);

  const replan = cli.requests[1]!.systemPrompt;
  expect(replan.split("# Task")[1]).toContain("Show todos as a board\n\nA board with a column per status.");
  expect(replan).toContain('#13 "Drag todos between columns" hold them');
  const { run: row, executions } = await inspect(db, run.id);
  expect(executions.filter((e) => e.nodeKey === "planner").map((e) => e.attempt)).toEqual([1, 2]);
  expect(row.state).toMatchObject({ task: "Show todos as a board\n\nA board with a column per status.", plan: part1, human: { gate: { option: "changes", split: true } } });
  const [next] = await db.select().from(questions).where(and(eq(questions.runId, run.id), isNull(questions.answer)));
  expect(next).toMatchObject({ question: "Review the plan from planner", options: ["approve", "changes", "fix"] });
});
