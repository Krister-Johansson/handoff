import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { cancelRun } from "./operations.ts";
import { createRun } from "./runs.ts";
import { inspect, seedGraph } from "./testing/harness.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/** A project with a plan on the repository's GitHub Project, and `run` to start a run on some of its tasks. */
async function planned() {
  const plan = new FakeProjects(new FakeGitHub());
  const { number } = await plan.createProject("octo", repo, "sample plan");
  const { project, graphVersion } = await seedGraph(db, linear);
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  const task = async (title: string) => {
    const created = await plan.createIssue(repo, { project: number, title, body: "", labels: ["task"] });
    plan.itemsOf(repo).get(created.number)!.status = "Running";
    return { number: created.number, title, url: created.url, body: "" };
  };
  const run = (issues: Awaited<ReturnType<typeof task>>[]) => createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Build it", issues });
  const statusOf = (n: number) => plan.getStatus(repo, number, n);
  return { plan, task, run, statusOf };
}

test("cancelling the latest run of a task sets it back to Ready", async () => {
  const { plan, task, run, statusOf } = await planned();
  const migration = await task("Add the migration");
  const cancelled = await run([migration]);
  await cancelRun(db, cancelled.id, { reason: "changed my mind", projects: plan });
  expect(await statusOf(migration.number)).toBe("Ready");
  const { events } = await inspect(db, cancelled.id);
  expect(events.filter((e) => e.type.startsWith("plan.")).map((e) => [e.type, e.payload])).toEqual([["plan.status", { issue: migration.number, status: "Ready" }]]);
});
