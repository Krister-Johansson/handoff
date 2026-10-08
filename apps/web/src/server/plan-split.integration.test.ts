import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, events, projects, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { answerQuestion } from "@handoff/engine/operations";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, runAgain, saveGraphVersion, splitPlan, startRunFromGraph } from "./graphs.ts";
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

/** A run on #11 (or the given issues) waiting at its plan gate, where the planner proposed a split into three parts. */
async function splitGate(issues = [11]) {
  const run = await startRunFromGraph(db, { projectId, graphName: "linear", task: "Add a board", issues }, github);
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
  // The run builds part 1 of #11, so its pull request names #11 without closing it.
  expect(run!.state.splitOf).toEqual({ issue: 11, parts: [drag!.number, filter!.number] });

  const [answered] = await db.select().from(questions).where(eq(questions.id, gate.questionId));
  expect(answered).toMatchObject({ option: "split", answeredBy: "krister" });
  expect(answered!.answer).toContain(`#${drag!.number} "Drag todos between columns", #${filter!.number} "Filter the board"`);
  const recorded = await db.select().from(events).where(eq(events.runId, gate.runId));
  expect(recorded.find((e) => e.type === "run.split")?.payload).toMatchObject({ issues: opened });
});

test("a split run run again keeps its split, so the new run's pull request does not close the run's issue either", async () => {
  const gate = await splitGate();
  const opened = await splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, gate.runId));

  const again = await runAgain(db, gate.runId, { github, from: "scratch" });

  expect(again.state.splitOf).toEqual({ issue: 11, parts: opened.map((i) => i.number) });
});

test("a run split before runs kept their split, run again, takes it from its run.split event", async () => {
  const gate = await splitGate();
  const opened = await splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" });
  const [split] = await db.select().from(runs).where(eq(runs.id, gate.runId));
  const before = { ...split!.state };
  delete before.splitOf;
  await db.update(runs).set({ status: "failed", state: before }).where(eq(runs.id, gate.runId));

  const again = await runAgain(db, gate.runId, { github, from: "scratch" });

  expect(again.state.splitOf).toEqual({ issue: 11, parts: opened.map((i) => i.number) });
});

test("with a plan, the parts are tasks under the task's story, with its labels, each blocked by the one before", async () => {
  github.issues.set(10, { number: 10, title: "Boards", url: "https://github.com/octo/sample/issues/10", body: "Boards for todos.", state: "open", labels: ["story"] });
  github.parents.set(11, 10);
  github.issues.get(11)!.labels = ["task", "human", "area: ui"];
  const gate = await splitGate();
  await setupPlan({ db, github, projects: plan }, projectId);

  const opened = await splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" });

  const [drag, filter] = await Promise.all(opened.map((i) => github.getIssue(repo, i.number, { parents: true })));
  for (const created of [drag!, filter!]) {
    expect(created.parents?.map((p) => p.number)).toEqual([10]);
    expect(created.labels).toEqual(["task", "human", "area: ui"]);
    expect(plan.itemsOf(repo).get(created.number)?.status).toBe("Shaping");
  }
  expect(await github.openBlockers(repo, drag!.number)).toEqual([11]);
  expect(await github.openBlockers(repo, filter!.number)).toEqual([drag!.number]);
  // A second answer finds the question answered and opens nothing more.
  const before = github.issues.size;
  await expect(splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" })).rejects.toThrow(/already answered/);
  expect(github.issues.size).toBe(before);
});

test("with a plan, the parts have no parent when the run's issue has none", async () => {
  const gate = await splitGate();
  await setupPlan({ db, github, projects: plan }, projectId);

  const opened = await splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" });

  for (const issue of opened) {
    const created = await github.getIssue(repo, issue.number, { parents: true });
    expect(created.parents).toEqual([]);
    expect(created.labels).toEqual(["task"]);
  }
});

test("a run on two issues drops the issue a later part repeats and names it in the answer", async () => {
  github.issues.set(12, { number: 12, title: "Filter the board", url: "https://github.com/octo/sample/issues/12", body: "Filter cards by tag.", state: "open" });
  const gate = await splitGate([11, 12]);

  const opened = await splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" });

  const filter = opened[1]!;
  const [run] = await db.select().from(runs).where(eq(runs.id, gate.runId));
  expect(run!.issues.map((i) => i.number)).toEqual([11]);
  expect(run!.state.issues?.map((i) => i.number)).toEqual([11]);
  const [answered] = await db.select().from(questions).where(eq(questions.id, gate.questionId));
  expect(answered!.answer).toContain(`#12 "Filter the board" is no longer part of this run; #${filter.number} holds its work.`);
  const recorded = await db.select().from(events).where(eq(events.runId, gate.runId));
  expect(recorded.find((e) => e.type === "run.split")?.payload).toMatchObject({ dropped: [{ number: 12, title: "Filter the board", heldBy: filter.number }] });
});

test("in a Flow project a split's parts land right after the run's task in Project order", async () => {
  const gate = await splitGate();
  const { project } = await setupPlan({ db, github, projects: plan }, projectId);
  await plan.addIssue(repo, { project: project.number, issue: 11, labels: ["task"] });
  const later = await plan.createIssue(repo, { project: project.number, title: "Later work", body: "Later.", labels: ["task"] });

  const opened = await splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" });

  expect([...plan.itemsOf(repo).keys()]).toEqual([11, ...opened.map((i) => i.number), later.number]);
});

test("in a Timeline project a split's parts land at the end of Project order", async () => {
  await db.update(projects).set({ planMode: "timeline" }).where(eq(projects.id, projectId));
  const gate = await splitGate();
  const { project } = await setupPlan({ db, github, projects: plan }, projectId);
  await plan.addIssue(repo, { project: project.number, issue: 11, labels: ["task"] });
  const later = await plan.createIssue(repo, { project: project.number, title: "Later work", body: "Later.", labels: ["task"] });
  const moves = vi.spyOn(plan, "moveItems");

  const opened = await splitPlan({ db, github, projects: plan }, { ...gate, answeredBy: "krister" });

  expect([...plan.itemsOf(repo).keys()]).toEqual([11, later.number, ...opened.map((i) => i.number)]);
  expect(moves).not.toHaveBeenCalled();
});
