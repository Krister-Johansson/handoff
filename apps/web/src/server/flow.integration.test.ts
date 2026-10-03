import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, nodeExecutions, permissionRequests, planPins, projects, projectSchedulers, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { loadFlow } from "./flow.ts";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/** A Flow project with a plan on a fake GitHub and the linear graph: planner, coder, pr and merge. */
async function flowProject() {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  await saveGraphVersion(db, { projectId: project.id, name: "linear", document: linear });
  const task = async (title: string) => (await plan.createIssue(repo, { project: number, title, body: "", labels: ["task"] })).number;
  /** A run on the task, which starts with its planner queued; the tests move its steps along. */
  const run = async (issue: number, createdAt: Date) => {
    const started = await startRunFromGraph(db, { projectId: project.id, graphName: "linear", task: "", issues: [{ number: issue, title: `Task ${issue}`, url: "", body: "" }] });
    await db.update(runs).set({ createdAt }).where(eq(runs.id, started.id));
    await db.update(nodeExecutions).set({ createdAt }).where(eq(nodeExecutions.runId, started.id));
    return started;
  };
  const read = async () => ({ items: await plan.listItems("octo", number, repo), priorityOptions: undefined });
  return { github, plan, project, number, task, run, read };
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

test("loadFlow gives each active run its steps done of the graph's steps and what it waits for", async () => {
  const { project, task, run, read } = await flowProject();
  const [inReview, working, asking, merging, finished] = [await task("Plan read model"), await task("Status writes"), await task("Board"), await task("Tree"), await task("Done one")];

  // Oldest first: the run in review, then the one working, the one asking permission and the one at its pull request.
  const review = await run(inReview, minutesAgo(50));
  const [planner] = await db.update(nodeExecutions).set({ status: "waiting" }).where(eq(nodeExecutions.runId, review.id)).returning();
  await db.insert(questions).values({ runId: review.id, nodeExecutionId: planner!.id, question: "Approve the plan?", context: { review: { from: "planner", kind: "plan" } } });
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, review.id));

  const work = await run(working, minutesAgo(40));
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, work.id));
  await seedExecution(db, work.id, { nodeKey: "coder", status: "running", createdAt: minutesAgo(39) });
  await db.update(runs).set({ status: "running" }).where(eq(runs.id, work.id));

  const ask = await run(asking, minutesAgo(30));
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, ask.id));
  const coder = await seedExecution(db, ask.id, { nodeKey: "coder", status: "running", createdAt: minutesAgo(29) });
  await db.insert(permissionRequests).values({ id: crypto.randomUUID(), runId: ask.id, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "pnpm install" } });
  await db.update(runs).set({ status: "running" }).where(eq(runs.id, ask.id));

  // Its planner and coder passed; its pull request waits for CI and reviews.
  const merge = await run(merging, minutesAgo(20));
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, merge.id));
  await seedExecution(db, merge.id, { nodeKey: "coder", status: "passed", createdAt: minutesAgo(19) });
  await seedExecution(db, merge.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", createdAt: minutesAgo(18) });
  await db.update(runs).set({ status: "waiting", prNumber: 88 }).where(eq(runs.id, merge.id));

  // A finished run holds no lane.
  const done = await run(finished, minutesAgo(60));
  await db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, done.id));

  const input = await loadFlow(db, project.id, await read());
  expect(input.runs.map(({ issue, runId, progress, waitsOn }) => ({ issue, runId, progress, waitsOn }))).toEqual([
    { issue: inReview, runId: review.id, progress: { done: 0, total: 4 }, waitsOn: "Waits on you: review" },
    { issue: working, runId: work.id, progress: { done: 1, total: 4 }, waitsOn: undefined },
    { issue: asking, runId: ask.id, progress: { done: 1, total: 4 }, waitsOn: "Waits on you: permission" },
    { issue: merging, runId: merge.id, progress: { done: 2, total: 4 }, waitsOn: "Waits for checks and merge" },
  ]);
  expect(input.runs[0]!.createdAt.getTime()).toBeLessThan(input.runs[1]!.createdAt.getTime());
  expect(input.latest.get(finished)).toEqual({ id: done.id, status: "succeeded" });
});

test("loadFlow reads lanes from max_runs, or 1 without a scheduler row, and the holds", async () => {
  const { project, task, run, read } = await flowProject();
  const failing = await task("Plan read model");
  const failed = await run(failing, minutesAgo(10));
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, failed.id));

  // Without a scheduler nothing holds: tasks start when someone starts them.
  expect(await loadFlow(db, project.id, await read())).toMatchObject({ lanes: 1, order: "project", skipLabel: "human", held: [] });

  await db.insert(projectSchedulers).values({ projectId: project.id, enabled: true, maxRuns: 3, graphName: "linear", skipLabel: "manual" });
  expect(await loadFlow(db, project.id, await read())).toMatchObject({ lanes: 3, order: "project", skipLabel: "manual", held: [`Run ${failed.id.slice(0, 8)} failed at a step`] });

  // A paused scheduler starts nothing either, so the failed run does not hold it.
  await db.update(projectSchedulers).set({ pausedAt: new Date(), pausedBy: "person" }).where(eq(projectSchedulers.projectId, project.id));
  expect(await loadFlow(db, project.id, await read())).toMatchObject({ lanes: 3, held: [] });
});

test("loadFlow reads the pins of open tasks and leaves out a pin on a closed task or on an issue outside the plan", async () => {
  const { github, project, task, read } = await flowProject();
  const [open, closed] = [await task("Plan read model"), await task("Status writes")];
  github.issues.get(closed)!.state = "closed";
  await db.insert(planPins).values([open, closed, 999].map((issue) => ({ projectId: project.id, issue, pinnedBy: "person", reason: "drop" as const })));

  const input = await loadFlow(db, project.id, await read());
  expect([...input.pins]).toEqual([open]);
  expect(input.minutes).toEqual({ S: 30, M: 60, L: 120 });
});
