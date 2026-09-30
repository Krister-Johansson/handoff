import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { listBacklog } from "./backlog.ts";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("the backlog lists open issues with the latest run that works on each, if any", async () => {
  const github = new FakeGitHub();
  for (const [number, title] of [[12, "Slugify drops digits"], [14, "Document slugify"], [15, "Add a license"]] as const) {
    github.issues.set(number, { number, title, url: `https://github.com/octo/sample/issues/${number}`, body: "", state: "open", updatedAt: `2026-09-30T0${number - 10}:00:00Z` });
  }
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const first = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [12] }, github);
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, first.id));
  const second = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues: [12, 14] }, github);
  await db.update(runs).set({ status: "waiting", prNumber: 21 }).where(eq(runs.id, second.id));

  const backlog = await listBacklog(db, github, project.id);
  expect(backlog.issues.map((i) => [i.number, i.run?.id ?? null, i.run?.status ?? null, i.run?.prNumber ?? null])).toEqual([
    [15, null, null, null],
    [14, second.id, "waiting", 21],
    [12, second.id, "waiting", 21],
  ]);
  expect(backlog.counts).toEqual({ todo: 1, started: 2, all: 3 });
});

test("without GitHub access the backlog says so", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  expect(await listBacklog(db, undefined, project.id)).toMatchObject({ error: expect.stringContaining("GitHub") });
});
