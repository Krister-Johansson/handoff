import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, events, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { answerQuestion } from "@handoff/engine/operations";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion, splitPlan, startRunFromGraph } from "./graphs.ts";
import { setupPlan } from "./shaping.ts";

const db = createTestDb();
const repo = { owner: "octo", name: "sample" };
let github: FakeGitHub;
let plan: FakeProjects;
let projectId: string;

beforeEach(async () => {
  await truncateAll(db);
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  projectId = project.id;
  await saveGraphVersion(db, { projectId, name: "linear", document: linear });
  github = new FakeGitHub();
  github.issues.set(11, { number: 11, title: "Add a board", url: "https://github.com/octo/sample/issues/11", body: "A board with drag and drop and filters.", state: "open" });
  plan = new FakeProjects(github);
});
afterAll(() => db.$client.end());

const parts = [
  { title: "Show todos as a board", body: "A board with a column per status.", ownedPaths: ["src/board.tsx"] },
  { title: "Drag todos between columns", body: "Drag a card to change its status.", ownedPaths: ["src/drag.ts"] },
  { title: "Filter the board", body: "Filter cards by tag.", ownedPaths: ["src/filter.ts"] },
];

/** A run on #11 waiting at its plan gate, where the planner proposed a split into three parts. */
async function splitGate() {
  const run = await startRunFromGraph(db, { projectId, graphName: "linear", task: "Add a board", issues: [11] }, github);
  const split = { status: "split", plan: "Three changes.", steps: [], ownedPaths: [], parts };
  await db.update(runs).set({ state: { ...run.state, plan: split } }).where(eq(runs.id, run.id));
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db
    .insert(questions)
    .values({
      runId: run.id,
      nodeExecutionId: gate.id,
      question: "Review the split from planner",
      options: ["split", "changes"],
      context: { reason: "approval", review: { from: "planner", kind: "split", markdown: "" }, split: { parts } },
    })
    .returning();
  return { runId: run.id, questionId: question!.id };
}

test("Split as proposed opens an issue per later part with Depends on links and narrows the run to the first", async () => {
  const gate = await splitGate();
  await expect(answerQuestion(db, gate.questionId, { answer: "Split it.", option: "split", answeredBy: "krister" })).rejects.toThrow(/issue for each later part/);

  const opened = await splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" });

  expect(opened.map((i) => i.title)).toEqual(["Drag todos between columns", "Filter the board"]);
  const [drag, filter] = await Promise.all(opened.map((i) => github.getIssue(repo, i.number, { parents: true })));
  expect(drag!.body).toContain("Drag a card to change its status.");
  expect(drag!.body).toContain("Depends on: #11");
  expect(filter!.body).toContain(`Depends on: #${drag!.number}`);
  expect(await github.openBlockers(repo, drag!.number)).toEqual([11]);
  expect(await github.openBlockers(repo, filter!.number)).toEqual([drag!.number]);
  expect(drag!.parents).toEqual([]);

  const [run] = await db.select().from(runs).where(eq(runs.id, gate.runId));
  expect(run!.task).toBe("Show todos as a board\n\nA board with a column per status.");
  expect(run!.state).toMatchObject({ task: run!.task });
  expect(run!.state.plan).toBeUndefined();
  expect(run!.issues.map((i) => i.number)).toEqual([11]);

  const [answered] = await db.select().from(questions).where(eq(questions.id, gate.questionId));
  expect(answered).toMatchObject({ option: "split", answeredBy: "krister" });
  expect(answered!.answer).toContain(`#${drag!.number} "Drag todos between columns", #${filter!.number} "Filter the board"`);
  const recorded = await db.select().from(events).where(eq(events.runId, gate.runId));
  expect(recorded.find((e) => e.type === "run.split")?.payload).toMatchObject({ issues: opened });
});

test("with a plan, the parts are sub-issues of the run's issue", async () => {
  const gate = await splitGate();
  await setupPlan({ db, github, projects: plan }, projectId);

  const opened = await splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" });

  for (const issue of opened) {
    const created = await github.getIssue(repo, issue.number, { parents: true });
    expect(created.parents?.map((p) => p.number)).toEqual([11]);
    expect(plan.itemsOf(repo).get(issue.number)?.status).toBe("Shaping");
  }
  // A second answer finds the question answered and opens nothing more.
  const before = github.issues.size;
  await expect(splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" })).rejects.toThrow(/already answered/);
  expect(github.issues.size).toBe(before);
});
