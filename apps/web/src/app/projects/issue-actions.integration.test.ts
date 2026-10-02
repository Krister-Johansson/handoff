import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { createProject, saveGraphVersion } from "@/server/graphs";

const db = createTestDb();
const env = vi.hoisted(() => ({ github: undefined as unknown, revalidated: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void env.revalidated.push(path) }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/github", () => ({ getGitHub: () => env.github, getProjects: () => undefined }));

const { assignAction, assignableAction, planAssignAction, planPeopleAction, startIssueRunAction } = await import("./issue-actions");

beforeEach(async () => {
  await truncateAll(db);
  env.revalidated.length = 0;
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

test("the Plan's assignee control lists the people by login and assigns on GitHub, the token's user for me, without moving the Status", async () => {
  const { github, project: p } = await project();
  github.assignable = [
    { login: "ann", avatarUrl: "a1" },
    { login: "octocat", avatarUrl: "a2" },
  ];
  expect(await planPeopleAction(p.id)).toEqual([{ login: "octocat" }, { login: "ann" }]);
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
  expect(await assignAction({ projectId: p.id, issue: 66, logins: [], me: true })).toEqual({ ok: true, assignees: ["octocat"] });
  expect(await assignAction({ projectId: p.id, issue: 66, logins: ["ann", "octocat"] })).toEqual({ ok: true, assignees: ["ann", "octocat"] });
  expect(await assignAction({ projectId: p.id, issue: 66, logins: [] })).toEqual({ ok: true, assignees: [] });
  expect(env.revalidated).toContain(`/projects/${p.id}/issues/66`);
  expect(await assignAction({ projectId: p.id, issue: 66, logins: ["stranger"] })).toEqual({ ok: false, error: expect.stringContaining("stranger cannot be assigned") });
});
