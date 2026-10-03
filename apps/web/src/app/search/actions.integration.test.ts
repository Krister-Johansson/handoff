import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject } from "@/server/graphs";

const db = createTestDb();
const env = vi.hoisted(() => ({ github: undefined as unknown, plan: undefined as unknown, cookies: new Map<string, string>() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/github", () => ({ getGitHub: () => env.github, getProjects: () => env.plan }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (env.cookies.has(name) ? { name, value: env.cookies.get(name) } : undefined) }) }));

const { searchRecordsAction, searchTasksAction } = await import("./actions");

beforeEach(async () => {
  await truncateAll(db);
  env.cookies.clear();
});
afterAll(() => db.$client.end());

test("outside a project, search covers the project used last in this browser", async () => {
  await createProject(db, { name: "alpha", repo: "octo/alpha", defaultBranch: "main" });
  const beta = await createProject(db, { name: "beta", repo: "octo/beta", defaultBranch: "main" });
  env.cookies.set("handoff_last_project", beta.id);

  expect((await searchRecordsAction({})).projectId).toBe(beta.id);
});

test("opening search twice reads the plan from GitHub once", async () => {
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  env.github = github;
  env.plan = plan;
  const p = await createProject(db, { name: "handoff", repo: "octo/handoff", defaultBranch: "main" });
  const { number } = await plan.createProject("octo", { owner: "octo", name: "handoff" }, "plan");
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, p.id));
  await plan.createIssue({ owner: "octo", name: "handoff" }, { project: number, title: "Plan read model", body: "", labels: ["task"] });
  const listItems = vi.spyOn(plan, "listItems");

  const first = await searchTasksAction({ projectId: p.id });
  const second = await searchTasksAction({ projectId: p.id });

  expect(first.tasks.map((t) => t.title)).toEqual(["Plan read model"]);
  expect(second).toEqual(first);
  expect(listItems).toHaveBeenCalledTimes(1);
});

test("a project id that is not one searches the project used last", async () => {
  const alpha = await createProject(db, { name: "alpha", repo: "octo/alpha", defaultBranch: "main" });
  expect((await searchTasksAction({ projectId: "nope" })).sources.map((s) => s.projectId)).toEqual([alpha.id]);
});
