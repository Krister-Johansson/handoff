import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, questions, runs, sql } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { listAttention } from "./attention";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("questions, failed runs and pull requests waiting for review each become one item that links to the run", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const start = (task: string) => startRunFromGraph(db, { projectId: project.id, graphName: "g", task });

  const asking = await start("Pick a license");
  const gate = await seedExecution(db, asking.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db.insert(questions).values({ runId: asking.id, nodeExecutionId: gate.id, question: "Which license?" }).returning();
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, asking.id));

  const failed = await start("Add a CHANGELOG.md");
  const coder = await seedExecution(db, failed.id, { nodeKey: "coder", status: "failed" });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, failed.id));

  const review = await start("Add usage docs");
  const pr = await seedExecution(db, review.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", waitKind: "github_pr" });
  await db.transaction((tx) => appendEvents(tx, review.id, [{ type: "github.pr", payload: { number: 7, url: "https://github.com/octo/sample/pull/7", ci: "success", review: "none" }, nodeExecutionId: pr.id }]));
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, review.id));

  const ci = await start("Still in CI");
  const pending = await seedExecution(db, ci.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", waitKind: "github_pr" });
  await db.transaction((tx) => appendEvents(tx, ci.id, [{ type: "github.pr", payload: { number: 8, ci: "pending", review: "none" }, nodeExecutionId: pending.id }]));

  const items = await listAttention(db);
  expect(items).toHaveLength(3);
  expect(items).toEqual(
    expect.arrayContaining([
      { id: `question:${question!.id}`, kind: "question", title: "sandbox: gate asks a question", body: "Which license?", href: `/runs/${asking.id}` },
      { id: `failed:${coder.id}`, kind: "failed", title: "sandbox: run failed at coder", body: "Add a CHANGELOG.md", href: `/runs/${failed.id}` },
      { id: `review:${pr.id}:7`, kind: "review", title: "sandbox: PR #7 waits for your review", body: "Add usage docs", href: `/runs/${review.id}` },
    ]),
  );
});

test("a review at a human gate says what needs approval and links to the review page", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build a todo app" });
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db
    .insert(questions)
    .values({ runId: run.id, nodeExecutionId: gate.id, question: "Review the plan from planner", options: ["approve", "changes"], context: { reason: "approval", from: "planner", review: { from: "planner", kind: "plan", markdown: "Plan" } } })
    .returning();
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, run.id));
  expect(await listAttention(db)).toEqual([
    { id: `question:${question!.id}`, kind: "question", title: "sandbox: the plan from planner needs your approval", body: "Build a todo app", href: `/runs/${run.id}/review/${question!.id}` },
  ]);
});

test("a run that reached a Finish node with notify on is listed as finished for a day, links to the run and needs no action", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const done = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Add a truncate helper" });
  const quiet = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Quiet run" });
  const old = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Old run" });
  await db.transaction((tx) => appendEvents(tx, done.id, [{ type: "run.finish", payload: { notify: true } }]));
  await db.transaction((tx) => appendEvents(tx, quiet.id, [{ type: "run.finish", payload: { notify: false } }]));
  await db.transaction((tx) => appendEvents(tx, old.id, [{ type: "run.finish", payload: { notify: true } }]));
  await db.execute(sql`update events set created_at = now() - interval '2 days' where run_id = ${old.id}`);
  for (const run of [done, quiet, old]) await db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, run.id));

  expect(await listAttention(db)).toEqual([{ id: `finished:${done.id}`, kind: "finished", title: "sandbox: run finished", body: "Add a truncate helper", href: `/runs/${done.id}` }]);
});
