import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { graphCrumb, projectCrumbs, projectTabCrumb, runCrumb } from "./crumbs";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("crumbs lead from Projects to a project, its tab, graph or run, each opening its siblings", async () => {
  const a = await createProject(db, { name: "alpha", repo: "octo/alpha", defaultBranch: "main" });
  await createProject(db, { name: "beta", repo: "octo/beta", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: a.id, name: "master", document: linear });
  await saveGraphVersion(db, { projectId: a.id, name: "quick", document: linear });
  const run = await startRunFromGraph(db, { projectId: a.id, graphName: "master", task: "#2 F02 PostgreSQL in Docker and environment validation" });

  const [projectsCrumb, projectCrumb] = await projectCrumbs(db, a);
  expect(projectsCrumb).toEqual({ label: "Projects", href: "/projects" });
  expect(projectCrumb!.menu!.map((m) => [m.label, m.current])).toEqual([
    ["alpha", true],
    ["beta", false],
  ]);
  expect(projectTabCrumb(a.id, "pulls")).toMatchObject({ label: "Pull requests", href: `/projects/${a.id}?tab=pulls` });
  expect((await graphCrumb(db, a.id, "master")).menu!.map((m) => [m.label, m.hint, m.current])).toEqual([
    ["master", "v1", true],
    ["quick", "v1", false],
  ]);
  const crumb = await runCrumb(db, a.id, run);
  expect(crumb.href).toBe(`/runs/${run.id}`);
  expect(crumb.menu![0]).toMatchObject({ href: `/runs/${run.id}`, current: true });
});
