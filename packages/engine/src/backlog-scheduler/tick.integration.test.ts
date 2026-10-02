import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { and, asc, eq, inArray, projects, projectSchedulers, runs, schedulerEvents, sql } from "@handoff/db";
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
  const events = async (type?: string) =>
    db
      .select()
      .from(schedulerEvents)
      .where(type ? and(eq(schedulerEvents.projectId, project.id), eq(schedulerEvents.type, type)) : eq(schedulerEvents.projectId, project.id))
      .orderBy(asc(schedulerEvents.id));
  const row = async () => (await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, project.id)))[0]!;
  return { github, plan, number, project, task, check, started, planOf, events, row };
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
