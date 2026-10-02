import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/** A project with a plan on a fake GitHub Project, an epic with a story, and a task under the story in Ready. */
async function planned() {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const create = (title: string, body: string, labels: string[], parent?: number) => plan.createIssue(repo, { project: number, title, body, labels, parent }).then((i) => i.number);
  const epic = await create("Project management", "Plan work on GitHub Projects.", ["epic"]);
  const story = await create("Shaping with the assistant", "As a person I shape work with the assistant.", ["story"], epic);
  const task = await create("Add the migration", "Add plan_project_number to projects.", ["task"], story);
  plan.itemsOf(repo).get(task)!.status = "Ready";
  const start = (issues: number[], opts: { withoutPlan?: boolean } = {}) =>
    startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "", issues }, github, opts.withoutPlan ? undefined : plan);
  return { github, plan, epic, story, task, start };
}

test("a run on a task carries the parent story and epic in run state", async () => {
  const { epic, story, task, start } = await planned();
  const run = await start([task]);
  expect(run.state.issues).toEqual([
    {
      number: task,
      title: "Add the migration",
      url: `https://github.com/octo/sample/issues/${task}`,
      body: "Add plan_project_number to projects.",
      lineage: [
        { kind: "story", number: story, title: "Shaping with the assistant", body: "As a person I shape work with the assistant." },
        { kind: "epic", number: epic, title: "Project management", body: "Plan work on GitHub Projects." },
      ],
    },
  ]);
});

test("a failing lineage read starts the run with the issue linked without its parents", async () => {
  const { plan, task, start } = await planned();
  plan.lineage = async () => {
    throw new Error("GitHub GraphQL: rate limited");
  };
  const run = await start([task]);
  expect(run.state.issues).toStrictEqual([
    { number: task, title: "Add the migration", url: `https://github.com/octo/sample/issues/${task}`, body: "Add plan_project_number to projects." },
  ]);
});

test("without a plan, a run reads the parent chain from GitHub's sub-issues", async () => {
  const { epic, story, task, start } = await planned();
  const run = await start([task], { withoutPlan: true });
  expect(run.state.issues?.[0]?.lineage).toEqual([
    { kind: "story", number: story, title: "Shaping with the assistant", body: "As a person I shape work with the assistant." },
    { kind: "epic", number: epic, title: "Project management", body: "Plan work on GitHub Projects." },
  ]);
});

test("without a plan, a failing parent read starts the run with the issue linked without its parents", async () => {
  const { github, task, start } = await planned();
  const getIssue = github.getIssue.bind(github);
  github.getIssue = async (repo, number, opts) => {
    if (opts?.parents) throw new Error("GitHub GraphQL: rate limited");
    return getIssue(repo, number);
  };
  const run = await start([task], { withoutPlan: true });
  expect(run.state.issues).toStrictEqual([
    { number: task, title: "Add the migration", url: `https://github.com/octo/sample/issues/${task}`, body: "Add plan_project_number to projects." },
  ]);
});

test("a run on an issue without parents has no lineage", async () => {
  const { github, start } = await planned();
  github.issues.set(90, { number: 90, title: "Fix the crash", url: "https://github.com/octo/sample/issues/90", body: "It crashes.", state: "open" });
  const run = await start([90]);
  expect(run.state.issues).toStrictEqual([{ number: 90, title: "Fix the crash", url: "https://github.com/octo/sample/issues/90", body: "It crashes." }]);
});
