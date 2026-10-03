import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { asc, eq, graphVersions, projects, projectSchedulers, runs, schedulerEvents } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { planPath } from "@/lib/paths";
import { createProject, saveGraphVersion } from "@/server/graphs";

const db = createTestDb();
const env = vi.hoisted(() => ({ projects: undefined as unknown, revalidated: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void env.revalidated.push(path) }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/github", () => ({ getGitHub: () => undefined, getProjects: () => env.projects }));

const { pauseSchedulerAction, releaseTaskAction, resumeSchedulerAction, saveSchedulerAction, switchToProjectOrderAction, turnOffSchedulerAction, turnOnSchedulerAction } = await import(
  "./scheduler-actions"
);

const repo = { owner: "octo", name: "sample" };
let projectId: string;

beforeEach(async () => {
  await truncateAll(db);
  env.revalidated.length = 0;
  const plan = new FakeProjects(new FakeGitHub());
  env.projects = plan;
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  projectId = (await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" })).id;
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, projectId));
  await saveGraphVersion(db, { projectId, name: "linear", document: linear });
});
afterAll(() => db.$client.end());

const row = async () => (await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)))[0];
const log = async () => (await db.select().from(schedulerEvents).where(eq(schedulerEvents.projectId, projectId)).orderBy(asc(schedulerEvents.id))).map((e) => [e.type, e.payload.by]);

test("the dashboard turns the scheduler on, pauses, saves while paused, resumes and turns it off, as the dashboard", async () => {
  expect(await turnOnSchedulerAction({ projectId, maxRuns: 2, order: "project", graph: "linear" })).toEqual({ ok: true });
  expect(await pauseSchedulerAction({ projectId, reason: "Lunch" })).toEqual({ ok: true });
  expect(await saveSchedulerAction({ projectId, maxRuns: 3, order: "project", graph: "linear", skipLabel: "" })).toEqual({ ok: true });
  expect(await row()).toMatchObject({ maxRuns: 3, skipLabel: null, pauseReason: "Lunch" });
  expect(await resumeSchedulerAction({ projectId })).toEqual({ ok: true });
  expect(await row()).toMatchObject({ pausedAt: null });
  expect(await turnOffSchedulerAction({ projectId })).toEqual({ ok: true });

  expect(await log()).toEqual([
    ["scheduler.started", "dashboard"],
    ["scheduler.paused", "dashboard"],
    ["scheduler.changed", "dashboard"],
    ["scheduler.resumed", "dashboard"],
    ["scheduler.stopped", "dashboard"],
  ]);
  expect(env.revalidated).toContain(`/projects/${projectId}/plan`);
});

test("a refusal comes back as a sentence to show, and bad input changes nothing", async () => {
  expect(await turnOnSchedulerAction({ projectId, maxRuns: 1, order: "priority", graph: "linear" })).toEqual({
    ok: false,
    error: expect.stringMatching(/has no Priority field/),
  });
  expect(await turnOnSchedulerAction({ projectId, maxRuns: 11, order: "project", graph: "linear" })).toEqual({ ok: false, error: "Runs at a time is 1 to 10." });
  expect(await row()).toBeUndefined();
});

test("the dashboard lets the scheduler take a task whose run a person cancelled", async () => {
  await turnOnSchedulerAction({ projectId, maxRuns: 1, order: "project", graph: "linear" });
  const [version] = await db.select().from(graphVersions);
  await db
    .insert(runs)
    .values({ projectId, graphVersionId: version!.id, task: "t", status: "cancelled", state: {}, baseBranch: "main", branchName: "b", issues: [{ number: 66, title: "t", url: "" }] });

  expect(await releaseTaskAction({ projectId, issue: 66 })).toEqual({ ok: true });
  expect((await log()).at(-1)).toEqual(["scheduler.released", "dashboard"]);
});

test("Switch to Project order from a Flow drop changes the order as the dashboard and revalidates the Plan page", async () => {
  await turnOnSchedulerAction({ projectId, maxRuns: 1, order: "project", graph: "linear" });
  await db.update(projectSchedulers).set({ order: "priority" }).where(eq(projectSchedulers.projectId, projectId));
  env.revalidated.length = 0;

  expect(await switchToProjectOrderAction({ projectId })).toEqual({ ok: true });
  expect(await row()).toMatchObject({ order: "project", enabled: true });
  expect((await log()).at(-1)).toEqual(["scheduler.changed", "dashboard"]);
  expect(env.revalidated).toContain(planPath(projectId));
});
