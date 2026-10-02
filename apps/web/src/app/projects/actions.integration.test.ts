import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion } from "@/server/graphs";

const db = createTestDb();
// The dashboard's environment: the test database, and fakes where it would reach GitHub.
const env = vi.hoisted(() => ({ github: undefined as unknown, projects: undefined as unknown, redirects: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => void env.redirects.push(path) }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/github", () => ({ getGitHub: () => env.github, getProjects: () => env.projects }));

const { runAgainAction, startRunAction } = await import("./actions");

beforeEach(async () => {
  await truncateAll(db);
  env.redirects.length = 0;
});
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/** A project with a plan and one task in Ready. */
async function readyTask() {
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
  return { project, issue: task.number, statusOf: () => plan.getStatus(repo, number, task.number) };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

test("starting a run from the Issues tab sets the task to Running", async () => {
  const { project, issue, statusOf } = await readyTask();
  await startRunAction({}, form({ projectId: project.id, graphName: "linear", task: "", issue: String(issue) }));
  expect(env.redirects).toEqual([expect.stringMatching(new RegExp(`/projects/${project.id}/runs/`))]);
  expect(await statusOf()).toBe("Running");
});

test("running a cancelled run again sets its task to Running", async () => {
  const { project, issue, statusOf } = await readyTask();
  await startRunAction({}, form({ projectId: project.id, graphName: "linear", task: "", issue: String(issue) }));
  const [first] = await db.select().from(runs);
  await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, first!.id));
  (env.projects as FakeProjects).itemsOf(repo).get(issue)!.status = "Ready";
  await runAgainAction({}, form({ runId: first!.id }));
  expect(env.redirects).toHaveLength(2);
  expect(await statusOf()).toBe("Running");
});
