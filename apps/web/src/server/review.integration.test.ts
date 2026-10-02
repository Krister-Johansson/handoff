import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { questions } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { getReview, markViewed } from "./review";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("a review question comes with its run, what to review and, once answered, the answer and comments", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build a todo app" });
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db
    .insert(questions)
    .values({ runId: run.id, nodeExecutionId: gate.id, question: "Review the plan from planner", context: { reason: "approval", review: { from: "planner", kind: "plan", markdown: "# Plan" } } })
    .returning();

  expect(await getReview(db, run.id, question!.id)).toMatchObject({
    id: question!.id,
    question: "Review the plan from planner",
    review: { from: "planner", kind: "plan", markdown: "# Plan" },
    task: "Build a todo app",
    projectName: "sandbox",
    answered: null,
  });
  expect(await getReview(db, crypto.randomUUID(), question!.id)).toBeUndefined();
});

async function gateRound(runId: string, attempt: number, answer?: { option: string; comments: { path?: string; body: string }[] }) {
  const gate = await seedExecution(db, runId, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: answer ? "passed" : "waiting", attempt });
  const [question] = await db
    .insert(questions)
    .values({
      runId,
      nodeExecutionId: gate.id,
      question: "Review the code from coder",
      context: { reason: "approval", review: { from: "coder", kind: "code", markdown: "Done." } },
      ...(answer ? { answer: "Round one.", option: answer.option, comments: answer.comments, answeredBy: "krister", answeredAt: new Date("2026-10-01T10:00:00Z") } : {}),
    })
    .returning();
  return question!;
}

test("a code review comes with the files marked viewed and the gate's earlier rounds", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build a todo app" });
  await gateRound(run.id, 1, { option: "changes", comments: [{ path: "src/a.ts", body: "Rename." }] });
  const other = await seedExecution(db, run.id, { nodeKey: "other-gate", nodeType: "human_gate", executorKind: "human", status: "passed" });
  await db.insert(questions).values({ runId: run.id, nodeExecutionId: other.id, question: "Other", answer: "x", option: "approve", comments: [{ body: "not this gate" }] });
  const current = await gateRound(run.id, 2);

  await markViewed(db, { runId: run.id, path: "src/a.ts", blobSha: "b1", viewed: true });
  await markViewed(db, { runId: run.id, path: "src/b.ts", blobSha: "b2", viewed: true });
  await markViewed(db, { runId: run.id, path: "src/b.ts", blobSha: "b2", viewed: false });

  const review = await getReview(db, run.id, current.id);
  expect(review?.views.map((v) => [v.path, v.blobSha])).toEqual([["src/a.ts", "b1"]]);
  expect(review?.earlier).toEqual([{ answer: "Round one.", option: "changes", comments: [{ path: "src/a.ts", body: "Rename." }], answeredAt: new Date("2026-10-01T10:00:00Z") }]);
});

test("marking a file viewed again moves its time forward", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build a todo app" });
  const question = await gateRound(run.id, 1);
  await markViewed(db, { runId: run.id, path: "src/a.ts", blobSha: "b1", viewed: true });
  const first = (await getReview(db, run.id, question.id))!.views[0]!.viewedAt;
  await markViewed(db, { runId: run.id, path: "src/a.ts", blobSha: "b1", viewed: true });
  const second = (await getReview(db, run.id, question.id))!.views[0]!.viewedAt;
  expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime());
  expect((await getReview(db, run.id, question.id))!.views).toHaveLength(1);
});

test("a code review comes with the findings of the step it reviews, from before the question", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build a todo app" });
  const comments = [{ path: "src/a.ts", line: 9, body: "Suggestion: name it." }];
  await seedExecution(db, run.id, { nodeKey: "code_review-1", nodeType: "code_review", status: "passed", output: { verdict: "approve", comments } });
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db
    .insert(questions)
    .values({ runId: run.id, nodeExecutionId: gate.id, question: "Review the code from code_review-1", context: { reason: "approval", review: { from: "code_review-1", kind: "code", markdown: "Verdict: approve", files: [] } } })
    .returning();
  // A later round's review is not this question's.
  await seedExecution(db, run.id, { nodeKey: "code_review-1", nodeType: "code_review", status: "passed", attempt: 2, output: { verdict: "request_changes", comments: [] } });

  // A finding from before severities reads as should_fix.
  expect((await getReview(db, run.id, question!.id))!.findings).toEqual({ verdict: "approve", comments: [{ ...comments[0], severity: "should_fix" }] });
});
