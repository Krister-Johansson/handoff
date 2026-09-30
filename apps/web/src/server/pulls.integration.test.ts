import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import { archiveRun, listProjectPulls, unarchiveRun } from "./pulls.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function projectWithPulls(github: FakeGitHub) {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const made: Record<string, string> = {};
  for (const state of ["open", "merged", "closed"] as const) {
    const run = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: `${state} one` });
    const pr = await github.createPr({ owner: "octo", name: "sample" }, { head: run.branchName, base: "main", title: `${state} one`, body: "" });
    const fake = github.prs.get(pr.number)!;
    if (state !== "open") Object.assign(fake, { state, merged: state === "merged" });
    await db.update(runs).set({ prNumber: pr.number, status: state === "open" ? "waiting" : "succeeded" }).where(eq(runs.id, run.id));
    made[state] = run.id;
  }
  return { project, made };
}

test("pull requests filter by their live state, open by default", async () => {
  const github = new FakeGitHub();
  const { project } = await projectWithPulls(github);
  const titles = async (state?: "open" | "merged" | "closed" | "all") => (await listProjectPulls(db, github, project.id, state ? { state } : {})).items.map((p) => p.title);
  expect(await titles()).toEqual(["open one"]);
  expect(await titles("merged")).toEqual(["merged one"]);
  expect(await titles("closed")).toEqual(["closed one"]);
  expect((await titles("all")).sort()).toEqual(["closed one", "merged one", "open one"]);
  expect((await listProjectPulls(db, github, project.id, {})).counts).toEqual({ open: 1, merged: 1, closed: 1, all: 3, archived: 0 });
});

test("an archived pull request leaves every list but Archived, and comes back when unarchived", async () => {
  const github = new FakeGitHub();
  const { project, made } = await projectWithPulls(github);
  await archiveRun(db, made.merged!);
  expect((await listProjectPulls(db, github, project.id, { state: "all" })).items.map((p) => p.title).sort()).toEqual(["closed one", "open one"]);
  const archived = await listProjectPulls(db, github, project.id, { state: "archived" });
  expect(archived.items.map((p) => [p.title, p.archived])).toEqual([["merged one", true]]);
  expect(archived.counts.archived).toBe(1);
  await unarchiveRun(db, made.merged!);
  expect((await listProjectPulls(db, github, project.id, { state: "archived" })).items).toEqual([]);
});

test("a run that is still active cannot be archived", async () => {
  const github = new FakeGitHub();
  const { made } = await projectWithPulls(github);
  await expect(archiveRun(db, made.open!)).rejects.toThrow(/still waiting/);
});
