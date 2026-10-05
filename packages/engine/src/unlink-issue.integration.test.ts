import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { RunStateSchema } from "@handoff/core";
import { appendEvents, eq, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { unlinkIssue } from "./operations.ts";
import { startRun as startRunOn } from "./start-run.ts";
import { inspect, seedGraph, startRun } from "./testing/harness.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };
const issue = (number: number, title: string) => ({ number, title, url: `https://github.com/octo/sample/issues/${number}`, body: "" });
const first = issue(3, "Board columns");
const later = issue(4, "Board drag and drop");

test("unlinking an issue drops it from the run and its state, and records who unlinked it", async () => {
  const { run } = await startRun(db, linear, "Build the board", [first, later]);
  const before = (await inspect(db, run.id)).run.stateVersion;

  await unlinkIssue(db, run.id, 4, { by: "dashboard" });

  const after = await inspect(db, run.id);
  expect(after.run.issues.map((i) => i.number)).toEqual([3]);
  expect(RunStateSchema.parse(after.run.state).issues?.map((i) => i.number)).toEqual([3]);
  expect(after.run.stateVersion).toBe(before + 1);
  expect(after.events.find((e) => e.type === "run.issue_unlinked")?.payload).toEqual({ issue: 4, by: "dashboard" });
});

/** A run on both issues whose pull request is open, with a description as the PR node writes it. */
async function runWithPr() {
  const { project, run } = await startRun(db, linear, "Build the board", [first, later]);
  const github = new FakeGitHub();
  const pr = await github.createPr(repo, { head: run.branchName, base: "main", title: "Build the board", body: `Adds the board.\n\nCloses #3\nCloses #4\n\nOpened by handoff run \`${run.id}\`.` });
  await db.update(runs).set({ prNumber: pr.number }).where(eq(runs.id, run.id));
  return { project, run, github, pr };
}

test("unlinking an issue drops its Closes line from the open pull request's description", async () => {
  const { run, github, pr } = await runWithPr();

  await unlinkIssue(db, run.id, 4, { by: "dashboard", github });

  const snapshot = await github.getPrSnapshot(repo, pr.number);
  expect(snapshot.body).toBe(`Adds the board.\n\nCloses #3\n\nOpened by handoff run \`${run.id}\`.`);
  expect(snapshot.title).toBe("Build the board");
  expect((await inspect(db, run.id)).events.find((e) => e.type === "run.issue_unlinked")?.payload).toEqual({ issue: 4, by: "dashboard", pr: pr.number });
});

test("once the pull request merged, unlinking is refused and the run keeps the issue", async () => {
  const merged = await runWithPr();
  merged.github.prs.get(merged.pr.number)!.merged = true;
  await expect(unlinkIssue(db, merged.run.id, 4, { by: "dashboard", github: merged.github })).rejects.toThrow(`Pull request #${merged.pr.number} of run ${merged.run.id} merged, so #4 stays linked.`);
  expect((await inspect(db, merged.run.id)).run.issues.map((i) => i.number)).toEqual([3, 4]);

  // The run's merge step recorded the merge: refused without asking GitHub.
  const recorded = await runWithPr();
  await db.transaction((tx) => appendEvents(tx, recorded.run.id, [{ type: "github.merged", payload: { number: recorded.pr.number } }]));
  await expect(unlinkIssue(db, recorded.run.id, 4, { by: "dashboard" })).rejects.toThrow(`Pull request #${recorded.pr.number} of run ${recorded.run.id} merged, so #4 stays linked.`);
  expect((await inspect(db, recorded.run.id)).types).not.toContain("run.issue_unlinked");
});

test("a run with a pull request needs GitHub to unlink an issue", async () => {
  const { run, pr } = await runWithPr();
  await expect(unlinkIssue(db, run.id, 4, { by: "cli" })).rejects.toThrow(`Unlinking #4 edits pull request #${pr.number}, which needs GitHub access (GITHUB_TOKEN or a GitHub App).`);
  expect((await inspect(db, run.id)).run.issues.map((i) => i.number)).toEqual([3, 4]);
});

test("an unlinked task the run moved on the plan goes back to the Status it had before the run", async () => {
  const plan = new FakeProjects(new FakeGitHub());
  const { number } = await plan.createProject("octo", repo, "board plan");
  const { project } = await seedGraph(db, linear);
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  const task = async (title: string) => {
    const created = await plan.createIssue(repo, { project: number, title, body: "", labels: ["task"] });
    plan.itemsOf(repo).get(created.number)!.status = "Ready";
    return { number: created.number, title, url: created.url, body: "" };
  };
  const columns = await task("Board columns");
  const drag = await task("Board drag and drop");
  const run = await startRunOn(db, { projectId: project.id, graphName: "g", task: "Build the board", issues: [columns, drag] }, { projects: plan });
  plan.itemsOf(repo).get(drag.number)!.status = "In review";

  await unlinkIssue(db, run.id, drag.number, { by: "dashboard", projects: plan });

  expect(await plan.getStatus(repo, number, drag.number)).toBe("Ready");
  expect(await plan.getStatus(repo, number, columns.number)).toBe("Running");
  expect((await inspect(db, run.id)).events.filter((e) => e.type === "plan.status").at(-1)?.payload).toEqual({ issue: drag.number, status: "Ready" });
});

test("an unlinked task the run never moved keeps its Status", async () => {
  const plan = new FakeProjects(new FakeGitHub());
  const { number } = await plan.createProject("octo", repo, "board plan");
  const created = await plan.createIssue(repo, { project: number, title: "Board drag and drop", body: "", labels: ["task"] });
  plan.itemsOf(repo).get(created.number)!.status = "Shaping";
  const { project, run } = await startRun(db, linear, "Build the board", [first, { ...later, number: created.number }]);
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));

  await unlinkIssue(db, run.id, created.number, { by: "dashboard", projects: plan });

  expect(await plan.getStatus(repo, number, created.number)).toBe("Shaping");
  expect((await inspect(db, run.id)).types.filter((t) => t.startsWith("plan."))).toEqual([]);
});

test("unlinking an issue the run does not link is refused", async () => {
  const { run } = await startRun(db, linear, "Build the board", [first]);
  await expect(unlinkIssue(db, run.id, 4, { by: "dashboard" })).rejects.toThrow(`Run ${run.id} does not link #4.`);
});
