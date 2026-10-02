import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, nodeExecutions, permissionRequests, questions, runs, sql } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { dismissAttention, listAttention } from "./attention";
import { createProject, runAgain, saveGraphVersion, startRunFromGraph } from "./graphs";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("a superseded run is not in list_attention", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const failed = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Add a CHANGELOG.md" });
  await seedExecution(db, failed.id, { nodeKey: "coder", status: "failed" });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, failed.id));
  const finished = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Add a truncate helper" });
  await db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, finished.id));
  await db.transaction((tx) => appendEvents(tx, finished.id, [{ type: "run.finish", payload: { notify: true } }]));
  expect(await listAttention(db)).toHaveLength(2);

  await runAgain(db, failed.id);
  await runAgain(db, finished.id);
  expect(await listAttention(db)).toEqual([]);
});

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
      { id: `question:${question!.id}`, kind: "question", title: "sandbox: gate asks a question", body: "Which license?", href: `/projects/${project.id}/runs/${asking.id}`, projectId: project.id },
      { id: `failed:${coder.id}`, kind: "failed", title: "sandbox: run failed at coder", body: "Add a CHANGELOG.md", href: `/projects/${project.id}/runs/${failed.id}`, projectId: project.id },
      { id: `review:${pr.id}:7`, kind: "review", title: "sandbox: PR #7 waits for your review", body: "Add usage docs", href: `/projects/${project.id}/runs/${review.id}`, projectId: project.id },
    ]),
  );
});

test("each item carries its project, and a project id narrows the list to that project's items", async () => {
  const ours = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  const theirs = await createProject(db, { name: "elsewhere", repo: "octo/other", defaultBranch: "main" });
  const failedIn = async (projectId: string, task: string) => {
    await saveGraphVersion(db, { projectId, name: "g", document: linear });
    const run = await startRunFromGraph(db, { projectId, graphName: "g", task });
    const coder = await seedExecution(db, run.id, { nodeKey: "coder", status: "failed" });
    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run.id));
    return coder;
  };
  const mine = await failedIn(ours.id, "Add a CHANGELOG.md");
  await failedIn(theirs.id, "Rename the package");

  expect((await listAttention(db)).map((i) => i.projectId).sort()).toEqual([ours.id, theirs.id].sort());
  expect(await listAttention(db, { projectId: ours.id })).toEqual([expect.objectContaining({ id: `failed:${mine.id}`, projectId: ours.id, body: "Add a CHANGELOG.md" })]);
});

test("a question is told by its summary, or cut short when it has none", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Pick a license" });
  const long = `${"The repository has no license file and the README names two. ".repeat(4)}Which license?`;
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: run.id, nodeExecutionId: gate.id, question: long, context: { reason: "needs_input", summary: "MIT or Apache-2.0?" } });
  const gate2 = await seedExecution(db, run.id, { nodeKey: "gate2", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: run.id, nodeExecutionId: gate2.id, question: long });
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, run.id));
  const bodies = Object.fromEntries((await listAttention(db)).map((item) => [item.title, item.body]));
  expect(bodies["sandbox: gate asks a question"]).toBe("MIT or Apache-2.0?");
  expect(bodies["sandbox: gate2 asks a question"]).toMatch(/^The repository has no license file .*…$/);
  expect(bodies["sandbox: gate2 asks a question"]!.length).toBeLessThanOrEqual(140);
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
    { id: `question:${question!.id}`, kind: "question", title: "sandbox: the plan from planner needs your approval", body: "Build a todo app", href: `/projects/${project.id}/runs/${run.id}/review/${question!.id}`, projectId: project.id },
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

  expect(await listAttention(db)).toEqual([{ id: `finished:${done.id}`, kind: "finished", title: "sandbox: run finished", body: "Add a truncate helper", href: `/projects/${project.id}/runs/${done.id}`, projectId: project.id }]);
});

test("a dismissed failure hides only that failure: the run's next failure and its finish are listed", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Add a CHANGELOG.md" });
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, run.id));
  const first = await seedExecution(db, run.id, { nodeKey: "coder", status: "failed" });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run.id));
  await dismissAttention(db, `failed:${first.id}`);
  expect(await listAttention(db)).toEqual([]);
  await db.update(nodeExecutions).set({ status: "repaired" }).where(eq(nodeExecutions.id, first.id));
  const second = await seedExecution(db, run.id, { nodeKey: "coder", status: "failed", attempt: 2 });
  expect((await listAttention(db)).map((i) => i.id)).toEqual([`failed:${second.id}`]);
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.id, second.id));
  await db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, run.id));
  await db.transaction((tx) => appendEvents(tx, run.id, [{ type: "run.finish", payload: { notify: true } }]));
  expect((await listAttention(db)).map((i) => i.id)).toEqual([`finished:${run.id}`]);
});

test("a permission prompt reads as its description and command, not as JSON", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Add a CHANGELOG.md" });
  const coder = await seedExecution(db, run.id, { nodeKey: "coder-1", status: "running", waitingOn: "permission" });
  const input = { command: "until grep -q finished /tmp/e2e.log; do sleep 5; done", timeout_ms: 600000, description: "e2e run finishing (re-arm)" };
  await db.insert(permissionRequests).values({ id: "3f6b2a10-0000-4000-8000-000000000001", runId: run.id, nodeExecutionId: coder.id, toolName: "Monitor", input });
  expect(await listAttention(db)).toEqual([
    expect.objectContaining({ kind: "permission", title: "sandbox: coder-1 asks to use Monitor", body: "e2e run finishing (re-arm) · until grep -q finished /tmp/e2e.log; do sleep 5; done" }),
  ]);
});
