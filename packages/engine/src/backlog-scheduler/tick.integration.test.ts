import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { and, asc, eq, projects, projectSchedulers, runs, schedulerEvents, sql } from "@handoff/db";
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
