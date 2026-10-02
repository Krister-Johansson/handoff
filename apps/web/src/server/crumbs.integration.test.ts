import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { graphCrumb, projectCrumb, projectRunsCrumb, runCrumb } from "./crumbs";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("crumbs lead from a project to its runs, graph or run; a graph or run opens its siblings", async () => {
  const a = await createProject(db, { name: "alpha", repo: "octo/alpha", defaultBranch: "main" });
  await createProject(db, { name: "beta", repo: "octo/beta", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: a.id, name: "master", document: linear });
  await saveGraphVersion(db, { projectId: a.id, name: "quick", document: linear });
  const run = await startRunFromGraph(db, { projectId: a.id, graphName: "master", task: "#2 F02 PostgreSQL in Docker and environment validation" });

  // The sidebar's switcher changes projects, so the project crumb only leads to the project.
  expect(projectCrumb(a)).toEqual({ label: "alpha", href: `/projects/${a.id}` });
  expect(projectRunsCrumb(a.id)).toEqual({ label: "Runs", href: `/projects/${a.id}/runs` });
  expect((await graphCrumb(db, a.id, "master")).menu!.map((m) => [m.label, m.hint, m.current])).toEqual([
    ["master", "v1", true],
    ["quick", "v1", false],
  ]);
  const crumb = await runCrumb(db, a.id, run);
  expect(crumb.href).toBe(`/projects/${a.id}/runs/${run.id}`);
  expect(crumb).toMatchObject({ menuLabel: "runs" });
  expect(crumb.menu![0]).toMatchObject({ href: `/projects/${a.id}/runs/${run.id}`, current: true, status: "queued" });
});
