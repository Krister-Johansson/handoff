import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject, saveGraphVersion } from "@/server/graphs";

const db = createTestDb();
const env = vi.hoisted(() => ({ github: undefined as unknown, projects: undefined as unknown, revalidated: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void env.revalidated.push(path) }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/github", () => ({ getGitHub: () => env.github, getProjects: () => env.projects }));

const { assignAction, assignableAction, planAssignAction, planPeopleAction, setMilestoneAction, startIssueRunAction } = await import("./issue-actions");

const repo = { owner: "octo", name: "sample" };

beforeEach(async () => {
  await truncateAll(db);
  env.revalidated.length = 0;
  env.projects = undefined;
});
afterAll(() => db.$client.end());

async function project() {
  const github = new FakeGitHub();
  env.github = github;
  github.issues.set(66, { number: 66, title: "Tasks service follow-ups", url: "https://github.com/octo/sample/issues/66", body: "", state: "open" });
  const created = await createProject(db, { name: "todooverkill", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: created.id, name: "linear", document: linear });
  return { github, project: created };
}

test("Start run on the issue page starts a run on the issue, stays on the page and says it assigned you", async () => {
  const { github, project: p } = await project();
  const result = await startIssueRunAction({ projectId: p.id, issue: 66, graphName: "linear" });
  expect(result).toEqual({ ok: true, runId: expect.any(String), assigned: "octocat" });
  expect(github.issues.get(66)!.assignees).toEqual(["octocat"]);
  expect(env.revalidated).toContain(`/projects/${p.id}/issues/66`);

  github.issues.set(67, { number: 67, title: "Another", url: "u", body: "", state: "open", assignees: ["ann"] });
  expect(await startIssueRunAction({ projectId: p.id, issue: 67, graphName: "linear" })).toEqual({ ok: true, runId: expect.any(String) });
  expect(await startIssueRunAction({ projectId: p.id, issue: 66, graphName: "linear" })).toEqual({ ok: false, error: expect.stringContaining("#66 is taken by run") });
});

test("the Plan's assignee control lists the people by login with their avatars and assigns on GitHub, the token's user for me, without moving the Status", async () => {
  const { github, project: p } = await project();
  github.assignable = [
    { login: "ann", avatarUrl: "a1" },
    { login: "octocat", avatarUrl: "a2" },
  ];
  expect(await planPeopleAction(p.id)).toEqual([
    { login: "octocat", avatarUrl: "a2" },
    { login: "ann", avatarUrl: "a1" },
  ]);
  expect(await planAssignAction(p.id, 66, { logins: ["ann"], me: true })).toEqual({ ok: true });
  expect(github.issues.get(66)!.assignees).toEqual(["ann", "octocat"]);
  expect(env.revalidated).toContain(`/projects/${p.id}/plan`);
  expect(await planAssignAction(p.id, 66, { logins: ["stranger"] })).toEqual({ ok: false, error: expect.stringContaining("stranger cannot be assigned") });

  env.github = undefined;
  await expect(planPeopleAction(p.id)).rejects.toThrow("GitHub access");
});

test("the assignee picker lists who can be assigned with you first, and assigning writes GitHub", async () => {
  const { github, project: p } = await project();
  github.assignable = [
    { login: "ann", avatarUrl: "a1" },
    { login: "octocat", avatarUrl: "a2" },
  ];
  expect(await assignableAction(p.id)).toEqual({
    repo: "octo/sample",
    users: [
      { login: "octocat", avatarUrl: "a2", you: true },
      { login: "ann", avatarUrl: "a1", you: false },
    ],
  });
  expect(await assignAction({ projectId: p.id, issue: 66, logins: [], me: true })).toEqual({ ok: true, assignees: [{ login: "octocat", avatarUrl: "a2" }] });
  expect(await assignAction({ projectId: p.id, issue: 66, logins: ["ann", "octocat"] })).toEqual({
    ok: true,
    assignees: [
      { login: "ann", avatarUrl: "a1" },
      { login: "octocat", avatarUrl: "a2" },
    ],
  });
  expect(await assignAction({ projectId: p.id, issue: 66, logins: [] })).toEqual({ ok: true, assignees: [] });
  expect(env.revalidated).toContain(`/projects/${p.id}/issues/66`);
  expect(await assignAction({ projectId: p.id, issue: 66, logins: ["stranger"] })).toEqual({ ok: false, error: expect.stringContaining("stranger cannot be assigned") });
});

/** A project with a plan: epic #1 in 0.9, story #2 under it, task #3 under the story, and #66 outside the plan; 0.9 and 1.0 open, 0.8 closed. */
async function plannedProject() {
  const { github, project: p } = await project();
  const plan = new FakeProjects(github);
  env.projects = plan;
  const { number } = await plan.createProject("octo", repo, "sample plan");
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, p.id));
  github.milestones.set(1, { number: 1, title: "0.8", dueOn: "2026-09-12", state: "closed" });
  github.milestones.set(2, { number: 2, title: "0.9", dueOn: "2026-10-20" });
  github.milestones.set(3, { number: 3, title: "1.0", dueOn: "2026-11-30" });
  const epic = await plan.createIssue(repo, { project: number, title: "Project management", body: "", labels: ["epic"], milestone: 2 });
  const story = await plan.createIssue(repo, { project: number, title: "Shaping with the assistant", body: "", labels: ["story"], parent: epic.number });
  const task = await plan.createIssue(repo, { project: number, title: "Milestone picker", body: "", labels: ["task"], parent: story.number });
  return { github, project: p, epic: epic.number, story: story.number, task: task.number };
}

test("the issue page's milestone picker sets a task's milestone on GitHub and says what it had, so Undo can put it back", async () => {
  const { github, project: p, task } = await plannedProject();
  expect(await setMilestoneAction({ projectId: p.id, issue: task, milestone: 3 })).toEqual({ ok: true, milestone: { number: 3, title: "1.0" }, from: null });
  expect(github.issues.get(task)!.milestone).toBe(3);
  expect(env.revalidated).toEqual(expect.arrayContaining([`/projects/${p.id}/issues/${task}`, `/projects/${p.id}/plan`, `/projects/${p.id}`]));

  expect(await setMilestoneAction({ projectId: p.id, issue: task, milestone: 2 })).toEqual({ ok: true, milestone: { number: 2, title: "0.9" }, from: { number: 3, title: "1.0" } });
  // Clear, which is also the first pick's Undo: null takes the milestone off.
  expect(await setMilestoneAction({ projectId: p.id, issue: task, milestone: null })).toEqual({ ok: true, milestone: null, from: { number: 2, title: "0.9" } });
  expect(github.issues.get(task)!.milestone).toBeUndefined();
  expect(github.milestoneWrites).toEqual([
    { number: task, milestone: 3 },
    { number: task, milestone: 2 },
    { number: task, milestone: null },
  ]);
});

test("the picker sets an epic's milestone on the epic alone, as set_milestone does", async () => {
  const { github, project: p, epic, story, task } = await plannedProject();
  expect(await setMilestoneAction({ projectId: p.id, issue: epic, milestone: 3 })).toEqual({ ok: true, milestone: { number: 3, title: "1.0" }, from: { number: 2, title: "0.9" } });
  expect(github.milestoneWrites).toEqual([{ number: epic, milestone: 3 }]);
  expect(github.issues.get(story)!.milestone).toBeUndefined();
  expect(github.issues.get(task)!.milestone).toBeUndefined();
});

test("the picker refuses a closed or unknown milestone and an issue outside the plan, and writes nothing", async () => {
  const { github, project: p, task } = await plannedProject();
  expect(await setMilestoneAction({ projectId: p.id, issue: task, milestone: 1 })).toEqual({ ok: false, error: expect.stringContaining("Milestone 0.8 (#1) of octo/sample is closed") });
  expect(await setMilestoneAction({ projectId: p.id, issue: task, milestone: 9 })).toEqual({ ok: false, error: expect.stringContaining("octo/sample has no milestone #9") });
  expect(await setMilestoneAction({ projectId: p.id, issue: 66, milestone: 2 })).toEqual({ ok: false, error: expect.stringContaining("#66 is not in the plan of todooverkill") });
  expect(await setMilestoneAction({ projectId: "not-a-project", issue: task, milestone: 2 })).toEqual({ ok: false, error: "That issue's milestone cannot be set from here." });
  expect(github.milestoneWrites).toEqual([]);
});
