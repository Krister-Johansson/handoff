import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { and, asc, eq, inArray, nodeExecutions, notifications, permissionRequests, projects, projectSchedulers, questions, runs, schedulerEvents, sql } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { startRun } from "../start-run.ts";
import { inspect, seedGraph } from "../testing/harness.ts";
import { checkProject } from "./tick.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/** A project whose plan is a fake GitHub Project, with its scheduler on. */
async function planned(settings: Partial<typeof projectSchedulers.$inferInsert> = {}) {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "sample plan");
  const { project } = await seedGraph(db, linear);
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  await db.insert(projectSchedulers).values({ projectId: project.id, enabled: true, graphName: "g", ...settings });
  /** A task on the plan, in Ready unless told otherwise. */
  const task = async (title: string, opts: { blockedBy?: number[]; status?: string } = {}) => {
    const created = (await plan.createIssue(repo, { project: number, title, body: "", labels: ["task"], blockedBy: opts.blockedBy ?? [] })).number;
    plan.itemsOf(repo).get(created)!.status = opts.status ?? "Ready";
    return created;
  };
  const check = (owner = "worker-1") => checkProject({ db, github, projects: plan, owner }, project.id);
  /** The runs of the project, oldest first, with the issue each works on. */
  const started = async () =>
    (await db.select().from(runs).where(eq(runs.projectId, project.id)).orderBy(asc(runs.createdAt))).map((r) => ({ id: r.id, issue: r.issues[0]?.number, startedBy: r.startedBy, status: r.status }));
  /** The run's planner passed: it has a plan with owned paths. */
  const planOf = (runId: string) =>
    db
      .update(runs)
      .set({ state: sql`${runs.state} || ${JSON.stringify({ plan: { plan: "Do it", steps: [], ownedPaths: ["src"] } })}::jsonb` })
      .where(eq(runs.id, runId));
  /** The run waits at a gate with an open question; returns the gate's step. */
  const wait = async (runId: string, context: Record<string, unknown>) => {
    await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, runId));
    const [gate] = await db
      .insert(nodeExecutions)
      .values({ runId, nodeKey: "human_gate-1", nodeType: "human_gate", executorKind: "human", attempt: 1, status: "waiting", waitKind: "human" })
      .returning();
    await db.insert(questions).values({ runId, nodeExecutionId: gate!.id, question: "Go on?", context });
    return gate!;
  };
  const events = async (type?: string) =>
    db
      .select()
      .from(schedulerEvents)
      .where(type ? and(eq(schedulerEvents.projectId, project.id), eq(schedulerEvents.type, type)) : eq(schedulerEvents.projectId, project.id))
      .orderBy(asc(schedulerEvents.id));
  const row = async () => (await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, project.id)))[0]!;
  return { github, plan, number, project, task, check, started, planOf, wait, events, row };
}

test("a check starts runs in order until max_runs runs are active", async () => {
  const p = await planned({ maxRuns: 2 });
  const first = await p.task("First in Project order");
  const second = await p.task("Second");
  await p.task("Third");

  await p.check();
  const [one] = await p.started();
  expect(one).toMatchObject({ issue: first, startedBy: "scheduler" });
  await p.planOf(one!.id);

  await p.check();
  const [, two] = await p.started();
  expect(two).toMatchObject({ issue: second, startedBy: "scheduler" });
  await p.planOf(two!.id);

  // Two runs are active: the third task waits for a slot.
  await p.check();
  expect((await p.started()).map((r) => r.issue)).toEqual([first, second]);
  expect((await p.row()).lastResult).toMatchObject({ state: "full", active: 2, maxRuns: 2 });

  const startedEvents = await p.events("scheduler.run_started");
  expect(startedEvents.map((e) => e.payload)).toEqual([
    { runId: one!.id, issue: first, place: 1 },
    { runId: two!.id, issue: second, place: 1 },
  ]);
  const { types, events } = await inspect(db, one!.id);
  expect(types.slice(0, 2)).toEqual(["run.created", "run.scheduled"]);
  expect(events[1]!.payload).toEqual({ place: 1, settings: { maxRuns: 2, order: "project", graphName: "g", skipLabel: "human" } });
});

test("a check in priority order starts the task with the highest Priority first", async () => {
  const p = await planned({ order: "priority" });
  p.plan.plans.get("octo/sample")!.project.priorityOptions = ["High", "Low"];
  const low = await p.task("Low, first in Project order");
  const high = await p.task("High");
  p.plan.itemsOf(repo).get(low)!.priority = "Low";
  p.plan.itemsOf(repo).get(high)!.priority = "High";

  await p.check();

  expect((await p.started()).map((r) => r.issue)).toEqual([high]);
  expect((await p.row()).lastResult).toMatchObject({ candidates: [{ number: low }] });
});

test("priority order from the issue field starts an Urgent task before a High one", async () => {
  const p = await planned({ order: "priority" });
  // The repository's owner is an organization with the default Priority issue field, and its Project has no Priority field.
  p.plan.owners.set("octo", "Organization");
  p.plan.priorityIssueFields.set("octo", ["Urgent", "High", "Medium", "Low"]);
  const high = await p.task("High, first in Project order");
  const none = await p.task("No priority");
  const urgent = await p.task("Urgent");
  p.plan.issuePriorities.set(high, "High");
  p.plan.issuePriorities.set(urgent, "Urgent");

  await p.check();

  expect((await p.started()).map((r) => r.issue)).toEqual([urgent]);
  expect((await p.row()).lastResult).toMatchObject({ candidates: [{ number: high }, { number: none }] });
});

test("runs a person started count toward max_runs", async () => {
  const p = await planned({ maxRuns: 2 });
  const mine = await p.task("Started by hand");
  const next = await p.task("Next for the scheduler");
  await p.task("After that");
  await startRun(db, { projectId: p.project.id, graphName: "g", task: "", issues: [mine], startedBy: "dashboard" }, { github: p.github, projects: p.plan });
  // A run a person started without an issue counts too.
  await startRun(db, { projectId: p.project.id, graphName: "g", task: "Tidy the README", startedBy: "claude-code" }, { github: p.github, projects: p.plan });
  const listItems = vi.spyOn(p.plan, "listItems");

  await p.check();

  expect((await p.started()).map((r) => r.startedBy)).toEqual(["dashboard", "claude-code"]);
  expect(listItems).not.toHaveBeenCalled();

  // The person's run without an issue ends: one slot is free, and the scheduler takes the next task.
  const [, untracked] = await p.started();
  await db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, untracked!.id));
  await p.check();
  expect((await p.started()).map((r) => [r.issue, r.startedBy])).toEqual([
    [mine, "dashboard"],
    [undefined, "claude-code"],
    [next, "scheduler"],
  ]);
});

test("a check with a hold starts nothing and reads nothing from GitHub", async () => {
  const p = await planned({ maxRuns: 3 });
  const broken = await p.task("Its run failed");
  await p.task("Ready and free");
  const failed = await startRun(db, { projectId: p.project.id, graphName: "g", task: "", issues: [broken], startedBy: "dashboard" }, { github: p.github, projects: p.plan });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, failed.id));
  const reads = [vi.spyOn(p.plan, "listItems"), vi.spyOn(p.plan, "getProject"), vi.spyOn(p.github, "openBlockers"), vi.spyOn(p.github, "getIssue"), vi.spyOn(p.github, "listIssues")];

  await p.check();

  expect(await p.started()).toHaveLength(1);
  for (const read of reads) expect(read).not.toHaveBeenCalled();
  expect((await p.row()).lastResult).toMatchObject({ state: "held", holds: [{ kind: "failed", runId: failed.id }] });
});

test("a run waiting on a review or a question does not hold: the next task starts while max_runs allows it, and a permission request holds", async () => {
  const p = await planned({ maxRuns: 3 });
  const reviewed = await p.task("Waits for its plan review");
  const asked = await p.task("Asks a question");
  await p.task("Next");

  await p.check();
  const [one] = await p.started();
  await p.planOf(one!.id);
  await p.wait(one!.id, { review: { from: "planner-1", kind: "plan" } });
  await p.check();
  const [, two] = await p.started();
  expect(two).toMatchObject({ startedBy: "scheduler" });
  expect((await p.started()).map((r) => r.issue)).toEqual([reviewed, asked]);
  await p.planOf(two!.id);
  const gate = await p.wait(two!.id, { reason: "question" });

  // Both waiting runs count toward max_runs: one slot is left, and a permission request holds it.
  await db.insert(permissionRequests).values({ id: crypto.randomUUID(), runId: two!.id, nodeExecutionId: gate.id, toolName: "Bash", input: { command: "rm -rf build" } });
  await p.check();
  expect(await p.started()).toHaveLength(2);
  expect((await p.row()).lastResult).toMatchObject({ state: "held", active: 2, holds: [{ kind: "permission", runId: two!.id }] });

  await db.update(permissionRequests).set({ status: "allowed" }).where(eq(permissionRequests.runId, two!.id));
  await p.check();
  expect(await p.started()).toHaveLength(3);
  expect((await p.row()).lastResult).toMatchObject({ state: "running", holds: [], active: 2 });
  expect(await p.events("scheduler.held")).toHaveLength(1);
});

test("with max_runs 1, a run waiting on a review fills the project", async () => {
  const p = await planned({ maxRuns: 1 });
  await p.task("Waits for its plan review");
  await p.task("Next");
  await p.check();
  const [one] = await p.started();
  await p.planOf(one!.id);
  await p.wait(one!.id, { review: { from: "planner-1", kind: "plan" } });

  await p.check();

  expect(await p.started()).toHaveLength(1);
  expect((await p.row()).lastResult).toMatchObject({ state: "full", holds: [], active: 1, maxRuns: 1 });
});

test("a check starts no run while a run the scheduler started has no plan", async () => {
  const p = await planned({ maxRuns: 3 });
  const byHand = await p.task("Started by hand, not planned yet");
  const first = await p.task("First");
  const second = await p.task("Second");
  // A person's run without a plan does not stop the scheduler: only its own runs plan one at a time.
  await startRun(db, { projectId: p.project.id, graphName: "g", task: "", issues: [byHand], startedBy: "dashboard" }, { github: p.github, projects: p.plan });

  await p.check();
  const listItems = vi.spyOn(p.plan, "listItems");
  await p.check();

  expect((await p.started()).map((r) => r.issue)).toEqual([byHand, first]);
  expect(listItems).not.toHaveBeenCalled();
  expect((await p.row()).lastResult).toMatchObject({ state: "idle", reason: "planning", active: 2 });
  expect((await p.events("scheduler.idle")).map((e) => e.payload)).toEqual([{ reason: "planning", runId: (await p.started())[1]!.id }]);

  await p.planOf((await p.started())[1]!.id);
  await p.check();
  expect((await p.started()).map((r) => r.issue)).toEqual([byHand, first, second]);
});

test("a refused start is skipped and the next candidate starts", async () => {
  const p = await planned();
  const first = await p.task("Blocked on GitHub since the Project was read");
  const second = await p.task("Free");
  // GitHub now records a blocker the Project read did not show yet.
  vi.spyOn(p.github, "openBlockers").mockImplementation(async (_repo, number) => (number === first ? [99] : []));

  await p.check();

  const [run] = await p.started();
  expect(run).toMatchObject({ issue: second, startedBy: "scheduler" });
  expect((await p.events("scheduler.skipped")).map((e) => e.payload)).toEqual([
    { issue: first, reason: `#${first} is blocked by #99 on GitHub. A run can start once they are closed.` },
  ]);
  expect((await p.events("scheduler.run_started")).map((e) => e.payload)).toEqual([{ runId: run!.id, issue: second, place: 2 }]);
  expect((await p.row()).lastResult).toMatchObject({ state: "running", skipped: [{ number: first, reason: expect.stringContaining("blocked by #99") }] });
  expect((await p.row()).startFailures).toBe(0);
});

test("a refusal is recorded once per issue and reason", async () => {
  const p = await planned();
  const first = await p.task("Blocked on GitHub");
  const second = await p.task("Blocked on GitHub too");
  const blockers = vi.spyOn(p.github, "openBlockers").mockResolvedValue([99]);

  await p.check();
  await p.check();
  blockers.mockResolvedValue([98]);
  await p.check();

  expect((await p.events("scheduler.skipped")).map((e) => [e.payload.issue, e.payload.reason])).toEqual([
    [first, `#${first} is blocked by #99 on GitHub. A run can start once they are closed.`],
    [second, `#${second} is blocked by #99 on GitHub. A run can start once they are closed.`],
    [first, `#${first} is blocked by #98 on GitHub. A run can start once they are closed.`],
    [second, `#${second} is blocked by #98 on GitHub. A run can start once they are closed.`],
  ]);
  expect((await p.row()).lastResult).toMatchObject({ state: "idle", reason: "all_skipped" });
  expect(await p.events("scheduler.idle")).toHaveLength(1);
});

test("three failed starts in a row pause the scheduler with the reason", async () => {
  const p = await planned({ maxRuns: 2, graphName: "gone" });
  await p.task("First");
  await p.task("Second");
  const listItems = vi.spyOn(p.plan, "listItems");

  // Two failures, then a start: the count starts over.
  listItems.mockRejectedValueOnce(new Error("GitHub said 502"));
  await p.check();
  await p.check();
  expect((await p.row()).startFailures).toBe(2);
  await db.update(projectSchedulers).set({ graphName: "g" }).where(eq(projectSchedulers.projectId, p.project.id));
  await p.check();
  expect((await p.row()).startFailures).toBe(0);
  await p.planOf((await p.started())[0]!.id);

  await db.update(projectSchedulers).set({ graphName: "gone" }).where(eq(projectSchedulers.projectId, p.project.id));
  await p.check();
  await p.check();
  expect((await p.row()).pausedAt).toBeNull();
  await p.check();
  // Paused: further checks do nothing until a person resumes it.
  await p.check();

  const row = await p.row();
  expect(row).toMatchObject({ pausedBy: "scheduler", pauseReason: "3 starts failed in a row. The last error: no graph named gone", startFailures: 3 });
  expect(row.pausedAt).toBeInstanceOf(Date);
  expect((await p.events("scheduler.start_failed")).map((e) => e.payload.error)).toEqual([
    "GitHub said 502",
    "no graph named gone",
    "no graph named gone",
    "no graph named gone",
    "no graph named gone",
  ]);
  expect((await p.events("scheduler.paused")).map((e) => e.payload)).toEqual([{ by: "scheduler", reason: row.pauseReason }]);
  expect(await db.select().from(notifications).where(eq(notifications.projectId, p.project.id))).toEqual([
    expect.objectContaining({ tone: "danger", title: `${p.project.name}: the scheduler paused itself`, body: row.pauseReason, href: `/projects/${p.project.id}/plan` }),
  ]);
  expect(await p.started()).toHaveLength(1);
});

test("two checks of one project at once start each task once", async () => {
  const p = await planned({ maxRuns: 3 });
  const tasks = [await p.task("First"), await p.task("Second"), await p.task("Third")];

  const results = await Promise.all([p.check("worker-1"), p.check("worker-2"), p.check("worker-1"), p.check("worker-3")]);

  expect((await p.started()).map((r) => r.issue)).toEqual([tasks[0]]);
  expect(results.filter((r) => r?.state === "running")).toHaveLength(1);
  expect(await p.events("scheduler.skipped")).toEqual([]);
  // The check let go of its lease: the next check runs.
  await p.planOf((await p.started())[0]!.id);
  await p.check("worker-2");
  expect((await p.started()).map((r) => r.issue)).toEqual(tasks.slice(0, 2));
  expect(await p.row()).toMatchObject({ leaseOwner: null, leaseExpiresAt: null });
});

test("a run a person starts while a check starts one counts, and the check does not pass max_runs", async () => {
  const p = await planned({ maxRuns: 1 });
  const next = await p.task("Next for the scheduler");
  const mine = await p.task("Started by hand");
  // The person's run starts after the check counted the active runs and before it inserts its own.
  let byHand: Promise<unknown> | undefined;
  vi.spyOn(p.github, "openBlockers").mockImplementation(async (_repo, number) => {
    if (number === next && !byHand) {
      byHand = startRun(db, { projectId: p.project.id, graphName: "g", task: "", issues: [mine], startedBy: "dashboard" }, { github: p.github, projects: p.plan });
      await byHand;
    }
    return [];
  });

  const result = await p.check();

  expect((await p.started()).map((r) => [r.issue, r.startedBy])).toEqual([[mine, "dashboard"]]);
  expect(result).toMatchObject({ state: "full" });
  expect(await p.events("scheduler.skipped")).toEqual([]);
});

test("held is recorded once until the reasons change", async () => {
  const p = await planned({ maxRuns: 3 });
  const one = await p.task("Its run failed");
  const two = await p.task("Its run failed later");
  await p.task("Waits");
  const fail = async (issue: number) => {
    const run = await startRun(db, { projectId: p.project.id, graphName: "g", task: "", issues: [issue], startedBy: "dashboard" }, { github: p.github, projects: p.plan });
    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run.id));
    return run;
  };
  const first = await fail(one);

  await p.check();
  await p.check();
  const second = await fail(two);
  await p.check();
  await p.check();
  // Both failures are cancelled: the hold clears, and the next hold is recorded again.
  await db.update(runs).set({ status: "cancelled" }).where(inArray(runs.id, [first.id, second.id]));
  await p.check();
  const third = (await p.started()).find((r) => r.startedBy === "scheduler")!;
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, third.id));
  await p.check();

  const held = (await p.events("scheduler.held")).map((e) => (e.payload.holds as { runId: string }[]).map((h) => h.runId));
  expect(held).toEqual([[first.id], [first.id, second.id], [third.id]]);
});

test("a superseded run does not make its task look cancelled to the scheduler", async () => {
  const p = await planned();
  const issue = await p.task("Run again by a person");
  const start = (again: boolean) => startRun(db, { projectId: p.project.id, graphName: "g", task: "", issues: [issue], startedBy: "dashboard", again }, { github: p.github, projects: p.plan });
  const earlier = await start(false);
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, earlier.id));
  // Run again: the new run takes the earlier one's place, which is marked superseded and cancelled.
  const again = await start(true);
  await db.update(runs).set({ status: "cancelled", supersededBy: again.id }).where(eq(runs.id, earlier.id));
  // The new run finished, and a person put the task back in Ready for more work.
  await db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, again.id));
  p.plan.itemsOf(repo).get(issue)!.status = "Ready";

  expect(await p.check()).toMatchObject({ state: "running", started: [{ issue }] });
});

test("a task whose cancelled run a person released starts on the next check", async () => {
  const p = await planned();
  const issue = await p.task("Cancelled by a person");
  const run = await startRun(db, { projectId: p.project.id, graphName: "g", task: "", issues: [issue], startedBy: "dashboard" }, { github: p.github, projects: p.plan });
  // Cancelling writes Ready back.
  await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, run.id));
  p.plan.itemsOf(repo).get(issue)!.status = "Ready";

  expect(await p.check()).toMatchObject({ state: "idle", reason: "all_skipped" });
  // An older release of another run of the issue does not count; this run's does.
  await db.insert(schedulerEvents).values({ projectId: p.project.id, type: "scheduler.released", payload: { issue, runId: "00000000-0000-0000-0000-000000000000", by: "dashboard" } });
  await db.update(projectSchedulers).set({ nextCheckAt: sql`now()`, lastCheckAt: null }).where(eq(projectSchedulers.projectId, p.project.id));
  expect(await p.check()).toMatchObject({ state: "idle", reason: "all_skipped" });
  await db.insert(schedulerEvents).values({ projectId: p.project.id, type: "scheduler.released", payload: { issue, runId: run.id, by: "dashboard" } });

  expect(await p.check()).toMatchObject({ state: "running", started: [{ issue }] });
});
