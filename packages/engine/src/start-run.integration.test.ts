import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { startRun } from "./start-run.ts";
import { seedGraph } from "./testing/harness.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** A project with graph g and open issues 11 and 12 on a fake GitHub. */
async function project() {
  const github = new FakeGitHub();
  for (const number of [11, 12]) {
    github.issues.set(number, { number, title: `Issue ${number}`, url: `https://github.com/octo/sample/issues/${number}`, body: "", state: "open" });
  }
  const { project } = await seedGraph(db, linear);
  const start = (issues: number[], startedBy = "dashboard") => startRun(db, { projectId: project.id, graphName: "g", task: "", issues, startedBy }, { github });
  return { github, project, start };
}

test("startRun refuses an issue that an active run links and names the run", async () => {
  const { start } = await project();
  const first = await start([11]);
  await expect(start([12, 11])).rejects.toThrow(`#11 is taken by run ${first.id}, which is queued.`);
  expect((await db.select().from(runs)).map((r) => r.id)).toEqual([first.id]);
});

test("two concurrent starts on one issue create one run", async () => {
  const { start } = await project();
  const results = await Promise.allSettled([start([11]), start([11]), start([11])]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.flatMap((r) => (r.status === "rejected" ? [(r.reason as Error).message] : []))).toEqual([
    expect.stringContaining("#11 is taken by run"),
    expect.stringContaining("#11 is taken by run"),
  ]);
  expect(await db.select().from(runs)).toHaveLength(1);
});
