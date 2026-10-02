import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { appendEvents, eq, nodeExecutions, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "@/server/graphs";

const db = createTestDb();
// The dashboard's environment: the test database, and fakes where it would reach GitHub.
const env = vi.hoisted(() => ({ github: undefined as unknown, projects: undefined as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/github", () => ({ getGitHub: () => env.github, getProjects: () => env.projects }));

const { cancelAction, resolveLoopAction } = await import("./actions");

beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/** A project with a plan, and a run started on one Ready task of it. */
async function runOnReadyTask() {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  env.github = github;
  env.projects = plan;
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  await saveGraphVersion(db, { projectId: project.id, name: "linear", document: linear });
  const task = await plan.createIssue(repo, { project: number, title: "Add the migration", body: "Add the column.", labels: ["task"] });
  plan.itemsOf(repo).get(task.number)!.status = "Ready";
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "linear", task: "", issues: [task.number] }, github, plan);
  return { run, statusOf: () => plan.getStatus(repo, number, task.number) };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

test("cancelling a run from the inbox sets its task back to Ready", async () => {
  const { run, statusOf } = await runOnReadyTask();
  expect(await statusOf()).toBe("Running");
  expect(await cancelAction({}, form({ runId: run.id }))).toEqual({ ok: true });
  expect(await statusOf()).toBe("Ready");
});

test("stopping a run whose loop ran out from the inbox sets its task back to Ready", async () => {
  const { run, statusOf } = await runOnReadyTask();
  const [planner] = await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, run.id)).returning();
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run.id));
  await db.transaction((tx) =>
    appendEvents(tx, run.id, [
      { type: "edge.exhausted", payload: { edgeKey: "planner->planner", attempts: 3 }, nodeExecutionId: planner!.id },
      { type: "run.failed", payload: { reason: "loop_exhausted", nodeKey: "planner", awaiting: "repair" } },
    ]),
  );
  expect(await resolveLoopAction({ runId: run.id, action: "stop" })).toEqual({ ok: true });
  expect(await statusOf()).toBe("Ready");
});
