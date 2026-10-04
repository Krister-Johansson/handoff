import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { asc, eq, graphVersions, projects, projectSchedulers, questions, runs, schedulerEvents } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { reviewPath, runPath } from "../lib/paths";
import { createProject, saveGraphVersion } from "./graphs";
import { loadSchedulerCard, schedulerStates } from "./scheduler-card";
import { pauseScheduler, releaseTask, startScheduler, stopScheduler, switchToProjectOrder } from "./scheduler";

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

test("switching to Project order from a Flow drop changes only the order: an off scheduler stays off and a paused one paused", async () => {
  await startScheduler(deps(), projectId, { maxRuns: 2 }, "dashboard");
  await db.update(projectSchedulers).set({ order: "priority" }).where(eq(projectSchedulers.projectId, projectId));
  await stopScheduler(db, projectId, "dashboard");

  await switchToProjectOrder(db, projectId, "dashboard");
  expect(await row()).toMatchObject({ enabled: false, order: "project", maxRuns: 2 });

  await startScheduler(deps(), projectId, {}, "dashboard");
  await db.update(projectSchedulers).set({ order: "priority", pausedAt: new Date(), pausedBy: "person", pauseReason: "Lunch" }).where(eq(projectSchedulers.projectId, projectId));
  await switchToProjectOrder(db, projectId, "dashboard");
  expect(await row()).toMatchObject({ enabled: true, order: "project", pauseReason: "Lunch", pausedAt: expect.any(Date) });
  // Project order already: nothing more is recorded.
  await switchToProjectOrder(db, projectId, "dashboard");

  const changed = (await log()).filter((e) => e.type === "scheduler.changed").map((e) => [(e.payload.from as { order: string }).order, (e.payload.to as { order: string }).order, e.payload.by]);
  expect(changed).toEqual([
    ["priority", "project", "dashboard"],
    ["priority", "project", "dashboard"],
  ]);
});

/** A task on the plan with one run of the given status, as a person started it. */
async function taskWithRun(status: "cancelled" | "failed" | "waiting") {
  const created = await plan.createIssue(repo, { project: [...plan.plans.values()][0]!.project.number, title: "Add the migration", body: "", labels: ["task"] });
  plan.itemsOf(repo).get(created.number)!.status = "Ready";
  const [run] = await db
    .insert(runs)
    .values({ projectId, graphVersionId: (await db.select().from(graphVersions))[0]!.id, task: "Add the migration", status, state: {}, baseBranch: "main", branchName: "handoff/x", issues: [{ number: created.number, title: "Add the migration", url: "" }] })
    .returning();
  return { issue: created.number, runId: run!.id };
}

test("letting the scheduler take a task records scheduler.released for its cancelled run and checks soon", async () => {
  await startScheduler(deps(), projectId, {}, "dashboard");
  await db.update(projectSchedulers).set({ nextCheckAt: new Date(Date.now() + 60_000), lastCheckAt: new Date(Date.now() - 60_000) }).where(eq(projectSchedulers.projectId, projectId));
  const { issue, runId } = await taskWithRun("cancelled");

  await releaseTask(db, projectId, issue, "dashboard");

  expect((await log()).at(-1)).toEqual({ type: "scheduler.released", payload: { issue, runId, by: "dashboard" } });
  expect((await row())!.nextCheckAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
});

test("the card names each active run's task and current step, and links the review a run waits for", async () => {
  await startScheduler(deps(), projectId, { maxRuns: 2 }, "dashboard");
  const working = await taskWithRun("waiting");
  await db.update(runs).set({ status: "running", startedBy: "scheduler" }).where(eq(runs.id, working.runId));
  await seedExecution(db, working.runId, { nodeKey: "coder-1", status: "running" });
  const reviewing = await taskWithRun("waiting");
  const gate = await seedExecution(db, reviewing.runId, { nodeKey: "human_gate-1", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [review] = await db.insert(questions).values({ runId: reviewing.runId, nodeExecutionId: gate.id, question: "Review the plan", options: ["approve"], context: { review: { markdown: "# Plan" } } }).returning();

  const card = await loadSchedulerCard(db, projectId);

  expect(card.runs).toEqual([
    {
      id: working.runId,
      href: runPath(projectId, working.runId),
      startedBy: "scheduler",
      issue: { number: working.issue, title: "Add the migration" },
      node: "coder-1",
      now: { tone: "active", text: "coder-1 is working" },
    },
    {
      id: reviewing.runId,
      href: runPath(projectId, reviewing.runId),
      startedBy: null,
      issue: { number: reviewing.issue, title: "Add the migration" },
      node: "human_gate-1",
      now: { tone: "attention", text: "human_gate-1 waits for your review" },
      reviewHref: reviewPath(projectId, reviewing.runId, review!.id),
    },
  ]);
});

test("the card names the task of each hold's run", async () => {
  await startScheduler(deps(), projectId, {}, "dashboard");
  const failed = await taskWithRun("failed");

  const card = await loadSchedulerCard(db, projectId);

  expect(card.status.holds.map((h) => h.runId)).toEqual([failed.runId]);
  expect(card.holdIssues).toEqual({ [failed.runId]: { number: failed.issue, title: "Add the migration" } });
});

test("the card reads the last 50 events, newest first, each as a sentence", async () => {
  await startScheduler(deps(), projectId, {}, "dashboard");
  for (let issue = 1; issue <= 60; issue++) await db.insert(schedulerEvents).values({ projectId, type: "scheduler.skipped", payload: { issue, reason: "labelled human" } });

  const { events } = await loadSchedulerCard(db, projectId);

  expect(events).toHaveLength(50);
  expect(events[0]).toEqual({ id: expect.any(Number), type: "scheduler.skipped", text: "Skipped #60: labelled human", at: expect.any(Date) });
  expect(events.at(-1)!.text).toBe("Skipped #11: labelled human");
});

test("a paused scheduler says where a person paused it from", async () => {
  await startScheduler(deps(), projectId, {}, "dashboard");
  await pauseScheduler(db, projectId, "claude-code", "Lunch");

  expect((await loadSchedulerCard(db, projectId)).pausedFrom).toBe("claude-code");
  await startScheduler(deps(), projectId, {}, "dashboard");
  expect((await loadSchedulerCard(db, projectId)).pausedFrom).toBeNull();
});

test("Next up comes from the plan the page read while the last check has none", async () => {
  await startScheduler(deps(), projectId, {}, "dashboard");
  const number = [...plan.plans.values()][0]!.project.number;
  const ready = async (title: string, labels = ["task"]) => {
    const created = await plan.createIssue(repo, { project: number, title, body: "", labels });
    plan.itemsOf(repo).get(created.number)!.status = "Ready";
    return created.number;
  };
  const first = await ready("First");
  const human = await ready("Screen reader pass", ["task", "human"]);
  const cancelled = await taskWithRun("cancelled");
  const second = await ready("Second");
  const items = await plan.listItems("octo", number, repo);

  // Turned on and not checked yet: the card runs the scheduler's own choice on the plan.
  const fresh = await loadSchedulerCard(db, projectId, { items, priorityOptions: undefined });
  expect(fresh.next).toEqual([
    { number: first, title: "First" },
    { number: second, title: "Second" },
  ]);
  expect(fresh.skipped).toEqual([
    { number: human, title: "Screen reader pass", reason: "labelled human" },
    { number: cancelled.issue, title: "Add the migration", reason: "cancelled run; start it by hand", releasable: true },
  ]);

  // Once a check found candidates, the card shows what the check found.
  await db.update(projectSchedulers).set({ lastResult: { state: "full", candidates: [{ number: second, title: "Second" }], skipped: [] } }).where(eq(projectSchedulers.projectId, projectId));
  expect((await loadSchedulerCard(db, projectId, { items, priorityOptions: undefined })).next).toEqual([{ number: second, title: "Second" }]);
  // Off, nothing is next.
  await stopScheduler(db, projectId, "dashboard");
  expect((await loadSchedulerCard(db, projectId, { items, priorityOptions: undefined })).next).toEqual([]);
});

test("each project whose scheduler is on has its state and its active runs of max runs; off has none", async () => {
  await createProject(db, { name: "other", repo: "octo/other", defaultBranch: "main" });
  await startScheduler(deps(), projectId, { maxRuns: 2 }, "dashboard");
  await taskWithRun("waiting");
  expect(await schedulerStates(db)).toEqual({ [projectId]: { state: "running", active: 1, maxRuns: 2 } });

  await taskWithRun("failed");
  expect(await schedulerStates(db)).toEqual({ [projectId]: { state: "held", active: 1, maxRuns: 2 } });
  await pauseScheduler(db, projectId, "dashboard");
  expect((await schedulerStates(db))[projectId]).toMatchObject({ state: "paused" });
  await stopScheduler(db, projectId, "dashboard");
  expect(await schedulerStates(db)).toEqual({});
});

/** A project for the repository acme/web of the organization acme, with a plan on a Project acme owns; returns its id and Project number. */
async function orgProject() {
  const project = await createProject(db, { name: "web", repo: "acme/web", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "linear", document: linear });
  plan.owners.set("acme", "Organization");
  const { number } = await plan.createProject("acme", { owner: "acme", name: "web" }, "web plan");
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  return { id: project.id, number };
}

test("start_scheduler with priority order in an organization repository accepts the Priority issue field when the Project has none", async () => {
  const org = await orgProject();
  plan.priorityIssueFields.set("acme", ["Urgent", "High", "Medium", "Low"]);

  expect(await startScheduler(deps(), org.id, { order: "priority" }, "dashboard")).toMatchObject({ state: "on", order: "priority" });
  expect((await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, org.id)))[0]).toMatchObject({ enabled: true, order: "priority" });
});

test("start_scheduler refuses priority order with neither and names both", async () => {
  const org = await orgProject();

  await expect(startScheduler(deps(), org.id, { order: "priority" }, "dashboard")).rejects.toThrow(
    `GitHub Project #${org.number} has no Priority field and acme has no Priority issue field, so the scheduler cannot order tasks by priority. Add a single select field named Priority, or use Project order.`,
  );
  expect(await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, org.id))).toEqual([]);
});

test("only a task whose latest run was cancelled can be let to the scheduler", async () => {
  await startScheduler(deps(), projectId, {}, "dashboard");
  const failed = await taskWithRun("failed");
  await expect(releaseTask(db, projectId, failed.issue, "dashboard")).rejects.toThrow(`#${failed.issue} is not waiting for a person after a cancelled run: its latest run ${failed.runId.slice(0, 8)} is failed.`);
  await expect(releaseTask(db, projectId, 999, "dashboard")).rejects.toThrow("#999 has no run, so the scheduler can take it already.");
  expect((await log()).filter((e) => e.type === "scheduler.released")).toEqual([]);
});
