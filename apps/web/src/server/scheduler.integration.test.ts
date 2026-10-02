import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { asc, eq, projects, projectSchedulers, schedulerEvents } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion } from "./graphs";
import { startScheduler, stopScheduler } from "./scheduler";

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
  plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, projectId));
});
afterAll(() => db.$client.end());

const deps = () => ({ db, projects: plan });
const row = async () => (await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)))[0];
const log = async () =>
  (await db.select({ type: schedulerEvents.type, payload: schedulerEvents.payload }).from(schedulerEvents).where(eq(schedulerEvents.projectId, projectId)).orderBy(asc(schedulerEvents.id)));

test("turning the scheduler off records scheduler.stopped, and turning it on again starts it as the first time did", async () => {
  await startScheduler(deps(), projectId, { maxRuns: 2 }, "dashboard");
  await db.update(projectSchedulers).set({ pausedAt: new Date(), pausedBy: "person", pauseReason: "Lunch" }).where(eq(projectSchedulers.projectId, projectId));

  expect(await stopScheduler(db, projectId, "dashboard")).toEqual({ state: "off" });
  expect(await row()).toMatchObject({ enabled: false, pausedAt: null, pausedBy: null, pauseReason: null, lastResult: null });
  // Off stays off, and says so once.
  expect(await stopScheduler(db, projectId, "dashboard")).toEqual({ state: "off" });

  await startScheduler(deps(), projectId, {}, "claude-code");
  expect(await row()).toMatchObject({ enabled: true, maxRuns: 2, pausedAt: null });
  expect((await log()).map((e) => [e.type, e.payload.by])).toEqual([
    ["scheduler.started", "dashboard"],
    ["scheduler.stopped", "dashboard"],
    ["scheduler.started", "claude-code"],
  ]);
});

test("the skip label is a setting: a label to leave tasks to a person, or null to skip none", async () => {
  await startScheduler(deps(), projectId, {}, "dashboard");
  expect(await row()).toMatchObject({ skipLabel: "human" });

  await startScheduler(deps(), projectId, { skipLabel: "manual" }, "dashboard");
  expect(await row()).toMatchObject({ skipLabel: "manual" });
  await startScheduler(deps(), projectId, { skipLabel: null }, "dashboard");
  expect(await row()).toMatchObject({ skipLabel: null });
  // Left out, it keeps the stored label.
  await startScheduler(deps(), projectId, { maxRuns: 2 }, "dashboard");
  expect(await row()).toMatchObject({ skipLabel: null, maxRuns: 2 });

  const changed = (await log()).filter((e) => e.type === "scheduler.changed").map((e) => [(e.payload.from as { skipLabel: unknown }).skipLabel, (e.payload.to as { skipLabel: unknown }).skipLabel]);
  expect(changed).toEqual([
    ["human", "manual"],
    ["manual", null],
    [null, null],
  ]);
});

test("saving settings while paused keeps the pause; only a resume resumes", async () => {
  await startScheduler(deps(), projectId, {}, "dashboard");
  await db.update(projectSchedulers).set({ pausedAt: new Date(), pausedBy: "person", pauseReason: "Lunch" }).where(eq(projectSchedulers.projectId, projectId));

  await startScheduler(deps(), projectId, { maxRuns: 3 }, "dashboard", { resume: false });
  expect(await row()).toMatchObject({ enabled: true, maxRuns: 3, pausedBy: "person", pauseReason: "Lunch", pausedAt: expect.any(Date) });

  await startScheduler(deps(), projectId, {}, "dashboard");
  expect(await row()).toMatchObject({ maxRuns: 3, pausedAt: null, pauseReason: null });
  expect((await log()).map((e) => e.type)).toEqual(["scheduler.started", "scheduler.changed", "scheduler.resumed"]);
});
