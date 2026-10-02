import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, projects, projectSchedulers, sql } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { seedGraph } from "../testing/harness.ts";
import { checkDueProjects, startBacklogScheduler } from "./loop.ts";
import { nudgeScheduler } from "./nudge.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/**
 * A project with a plan and its scheduler on, due for its first check. Nothing is Ready, so every
 * check reads the plan once and starts nothing: the reads count the checks.
 */
async function planned(settings: Partial<typeof projectSchedulers.$inferInsert> = {}) {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "sample plan");
  const { project } = await seedGraph(db, linear);
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  await db.insert(projectSchedulers).values({ projectId: project.id, enabled: true, graphName: "g", ...settings });
  const reads = vi.spyOn(plan, "listItems");
  const deps = { db, github, projects: plan, owner: "worker-1" };
  /** Seconds from the last check to the next one. */
  const gap = async () => {
    const [row] = await db
      .select({ s: sql<number>`round(extract(epoch from ${projectSchedulers.nextCheckAt} - ${projectSchedulers.lastCheckAt}))::int` })
      .from(projectSchedulers)
      .where(eq(projectSchedulers.projectId, project.id));
    return row!.s;
  };
  /** Time passes: the last and the next check move `seconds` into the past. */
  const elapse = (seconds: number) =>
    db
      .update(projectSchedulers)
      .set({
        lastCheckAt: sql`${projectSchedulers.lastCheckAt} - make_interval(secs => ${seconds})`,
        nextCheckAt: sql`${projectSchedulers.nextCheckAt} - make_interval(secs => ${seconds})`,
      })
      .where(eq(projectSchedulers.projectId, project.id));
  return { project, plan, reads, deps, gap, elapse };
}

test("a project is checked again 60 seconds after its last check", async () => {
  const p = await planned();

  const loop = startBacklogScheduler(p.deps, { pollMs: 20 });
  await expect.poll(() => p.reads.mock.calls.length).toBe(1);
  // Several more polls find nothing due.
  await new Promise((r) => setTimeout(r, 100));
  await loop.stop();
  expect(p.reads).toHaveBeenCalledTimes(1);
  expect(await p.gap()).toBe(60);

  await p.elapse(59);
  expect(await checkDueProjects(p.deps)).toEqual([]);
  await p.elapse(1);
  expect(await checkDueProjects(p.deps)).toEqual([p.project.id]);
  expect(p.reads).toHaveBeenCalledTimes(2);
});
