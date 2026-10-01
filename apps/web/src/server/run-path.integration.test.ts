import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { runPathOf } from "./run-path";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("an old /runs link finds the run's place under its project", async () => {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Build a todo app" });
  expect(await runPathOf(db, run.id)).toBe(`/projects/${project.id}/runs/${run.id}`);
  expect(await runPathOf(db, run.id, "q1")).toBe(`/projects/${project.id}/runs/${run.id}/review/q1`);
  expect(await runPathOf(db, crypto.randomUUID())).toBeUndefined();
  expect(await runPathOf(db, "not-a-uuid")).toBeUndefined();
});
