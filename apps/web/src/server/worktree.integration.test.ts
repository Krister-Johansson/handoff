import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { eq, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs";
import { runWorktree } from "./worktree";

const db = createTestDb();
let home: string;
beforeEach(async () => {
  await truncateAll(db);
  home = mkdtempSync(join(tmpdir(), "handoff-home-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));
afterAll(() => db.$client.end());

async function aRun() {
  const project = await createProject(db, { name: "alpha", repo: "octo/alpha", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "master", document: linear });
  return startRunFromGraph(db, { projectId: project.id, graphName: "master", task: "#55 Shaping tools in the catalog" });
}
const set = (id: string, values: Partial<typeof runs.$inferInsert>) => db.update(runs).set(values).where(eq(runs.id, id));

test("the button's state follows the run row and the folder on disk", async () => {
  const run = await aRun();
  expect(await runWorktree(db, run.id, home)).toEqual({ state: "not-created" });

  const path = join(home, "worktrees", run.id);
  await set(run.id, { status: "running", worktreePath: path });
  expect(await runWorktree(db, run.id, home)).toEqual({ state: "missing", shown: path });

  mkdirSync(path, { recursive: true });
  expect(await runWorktree(db, run.id, home)).toEqual({ state: "open", path, shown: path, running: true });
  await set(run.id, { status: "failed" });
  expect(await runWorktree(db, run.id, home)).toMatchObject({ state: "open", running: false });

  await set(run.id, { worktreePath: null });
  expect(await runWorktree(db, run.id, home)).toEqual({ state: "removed-by-gc" });
  await set(run.id, { status: "succeeded", prNumber: 88 });
  expect(await runWorktree(db, run.id, home)).toEqual({ state: "released", prNumber: 88 });
});

test("a path the worker did not make for this run gets no link", async () => {
  const run = await aRun();
  const other = await startRunFromGraph(db, { projectId: run.projectId, graphName: "master", task: "#56 Another" });
  const path = join(home, "worktrees", other.id);
  mkdirSync(path, { recursive: true });
  await set(run.id, { status: "running", worktreePath: path });
  expect(await runWorktree(db, run.id, home)).toEqual({ state: "missing", shown: path });
});

test("an unknown run has no worktree", async () => {
  expect(await runWorktree(db, "00000000-0000-4000-8000-000000000000", home)).toBeUndefined();
});
