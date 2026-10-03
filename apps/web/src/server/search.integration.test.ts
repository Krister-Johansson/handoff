import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { assistantConversations, eq, graphs, graphVersions, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { GitHubReadError } from "@handoff/github";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createProject } from "./graphs.ts";
import { searchRecords, searchTasks } from "./search.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$client.end());

/** A handoff project on octo/<repo> with a graph version its runs can point at. */
async function project(name: string, opts: { mode?: "flow" | "timeline" } = {}) {
  const created = await createProject(db, { name, repo: `octo/${name}`, defaultBranch: "main" });
  if (opts.mode) await db.update(projects).set({ planMode: opts.mode }).where(eq(projects.id, created.id));
  const [graph] = await db.insert(graphs).values({ projectId: created.id, name: "g", latestVersion: 1 }).returning();
  const [version] = await db.insert(graphVersions).values({ graphId: graph!.id, version: 1, document: {} }).returning();
  const run = async (values: { issues?: { number: number; title: string }[]; task?: string; status?: "queued" | "running" | "waiting" | "succeeded" | "failed"; branch?: string; createdAt?: Date }) => {
    const [row] = await db
      .insert(runs)
      .values({
        projectId: created.id,
        graphVersionId: version!.id,
        status: values.status ?? "succeeded",
        task: values.task ?? "",
        state: {},
        baseBranch: "main",
        branchName: values.branch ?? "handoff/run",
        issues: (values.issues ?? []).map((i) => ({ ...i, url: `https://github.com/octo/${name}/issues/${i.number}` })),
        ...(values.createdAt ? { createdAt: values.createdAt } : {}),
      })
      .returning();
    return row!;
  };
  return { ...created, run, repo: { owner: "octo", name } };
}

/** A project whose plan is a GitHub Project holding an epic, a story under it and a task under the story. */
async function planned(name: string, opts: { mode?: "flow" | "timeline" } = {}) {
  const p = await project(name, opts);
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", p.repo, `${name} plan`);
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, p.id));
  const issue = async (title: string, labels: string[], parent?: number) => (await plan.createIssue(p.repo, { project: number, title, body: "", labels, parent })).number;
  const epic = await issue("Flow", ["epic"]);
  const story = await issue("Plans on GitHub Projects", ["story"], epic);
  const task = await issue("Plan read model and the Ready gate", ["task"], story);
  plan.itemsOf(p.repo).get(task)!.status = "Ready";
  return { ...p, github, plan, epic, story, task };
}

test("the tasks of a planned project come from its plan with kind, status and parent", async () => {
  const p = await planned("handoff");
  p.github.issues.get(p.epic)!.state = "closed";

  const found = await searchTasks(db, p.github, p.plan, { projectId: p.id });

  expect(found.sources).toEqual([{ projectId: p.id, repo: "octo/handoff", source: "plan" }]);
  expect(found.tasks).toEqual([
    { projectId: p.id, number: p.epic, title: "Flow", kind: "epic", status: "Done", state: "closed" },
    { projectId: p.id, number: p.story, title: "Plans on GitHub Projects", kind: "story", status: "Shaping", state: "open", parent: { number: p.epic, title: "Flow", kind: "epic" } },
    {
      projectId: p.id,
      number: p.task,
      title: "Plan read model and the Ready gate",
      kind: "task",
      status: "Ready",
      state: "open",
      parent: { number: p.story, title: "Plans on GitHub Projects", kind: "story" },
    },
  ]);
});

test("opening search twice within the cache life reads GitHub once, and again after it", async () => {
  const p = await planned("handoff");
  const listItems = vi.spyOn(p.plan, "listItems");
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);

  await searchTasks(db, p.github, p.plan, { projectId: p.id, maxAgeMs: 60_000 });
  now.mockReturnValue(1_000_000 + 59_000);
  const second = await searchTasks(db, p.github, p.plan, { projectId: p.id, maxAgeMs: 60_000 });
  expect(listItems).toHaveBeenCalledTimes(1);
  expect(second.tasks).toHaveLength(3);

  now.mockReturnValue(1_000_000 + 61_000);
  await searchTasks(db, p.github, p.plan, { projectId: p.id, maxAgeMs: 60_000 });
  expect(listItems).toHaveBeenCalledTimes(2);
});

test("when GitHub fails, tasks fall back to the issues of the project's runs without a status, and the next search reads GitHub again", async () => {
  const p = await planned("handoff");
  await p.run({ issues: [{ number: 53, title: "Plan read model and the Ready gate" }], branch: "feat/53" });
  const later = await p.run({ issues: [{ number: 47, title: "Plan mode switch" }, { number: 53, title: "Plan read model and the Ready gate" }], createdAt: new Date(Date.now() + 1000) });
  const listItems = vi.spyOn(p.plan, "listItems").mockRejectedValue(new GitHubReadError("unreachable", "GitHub did not answer for the plan: API rate limit exceeded"));

  const found = await searchTasks(db, p.github, p.plan, { projectId: p.id, maxAgeMs: 60_000 });

  expect(found.sources).toEqual([{ projectId: p.id, repo: "octo/handoff", source: "runs", error: "GitHub did not answer for the plan: API rate limit exceeded" }]);
  expect(found.tasks).toEqual([
    { projectId: p.id, number: 47, title: "Plan mode switch", fromRun: later.id.slice(0, 8) },
    { projectId: p.id, number: 53, title: "Plan read model and the Ready gate", fromRun: later.id.slice(0, 8) },
  ]);

  listItems.mockRestore();
  const again = await searchTasks(db, p.github, p.plan, { projectId: p.id, maxAgeMs: 60_000 });
  expect(again.sources[0]!.source).toBe("plan");
});

test("a project without a plan searches its open issues", async () => {
  const p = await project("docs");
  const gh = new FakeGitHub();
  gh.issues.set(12, { number: 12, title: "Checkout guide", url: "https://github.com/octo/docs/issues/12", body: "", state: "open" });
  gh.issues.set(13, { number: 13, title: "Closed one", url: "https://github.com/octo/docs/issues/13", body: "", state: "closed" });

  const found = await searchTasks(db, gh, new FakeProjects(gh), { projectId: p.id });

  expect(found.sources).toEqual([{ projectId: p.id, repo: "octo/docs", source: "issues" }]);
  expect(found.tasks).toEqual([{ projectId: p.id, number: 12, title: "Checkout guide" }]);
});

test("other projects' tasks come only when the scope is all projects", async () => {
  const handoff = await planned("handoff");
  const shop = await project("shop");
  const gh = handoff.github;
  gh.issues.set(31, { number: 31, title: "Checkout keeps the cart", url: "https://github.com/octo/shop/issues/31", body: "", state: "open" });

  const current = await searchTasks(db, gh, handoff.plan, { projectId: handoff.id });
  expect(new Set(current.tasks.map((t) => t.projectId))).toEqual(new Set([handoff.id]));

  const all = await searchTasks(db, gh, handoff.plan, { projectId: handoff.id, all: true });
  expect(all.sources.map((s) => [s.repo, s.source])).toEqual([
    ["octo/handoff", "plan"],
    ["octo/shop", "issues"],
  ]);
  expect(all.tasks.filter((t) => t.projectId === shop.id).map((t) => t.number)).toContain(31);
});

test("records list every project, the latest runs of each project and chats by title", async () => {
  const handoff = await project("handoff", { mode: "timeline" });
  const shop = await project("shop");
  const run = await handoff.run({ issues: [{ number: 53, title: "Plan read model" }], status: "running", branch: "feat/53-plan-read-model" });
  await db.update(runs).set({ prNumber: 88 }).where(eq(runs.id, run.id));
  await handoff.run({ task: "Tidy the README\nwith details", branch: "handoff/tidy" });
  await shop.run({ issues: [{ number: 31, title: "Checkout keeps the cart" }] });
  await db.insert(assistantConversations).values([
    { title: "Plan the voice epic", projectId: handoff.id, pinnedAt: new Date(), updatedAt: new Date("2026-09-01T00:00:00Z") },
    { title: "Why checkout drops the cart", projectId: shop.id, updatedAt: new Date("2026-09-02T00:00:00Z") },
    { title: "Outside any project", updatedAt: new Date("2026-09-03T00:00:00Z") },
  ]);

  const records = await searchRecords(db, { projectId: handoff.id });

  expect(records.projectId).toBe(handoff.id);
  expect(records.projects).toEqual([
    { id: handoff.id, name: "handoff", repo: "octo/handoff", planMode: "timeline", current: true },
    { id: shop.id, name: "shop", repo: "octo/shop", planMode: "flow", current: false },
  ]);
  expect(records.runs.find((r) => r.id === run.id)).toEqual({
    id: run.id,
    shortId: run.id.slice(0, 8),
    projectId: handoff.id,
    title: "Plan read model",
    issues: [53],
    status: "running",
    branch: "feat/53-plan-read-model",
    prNumber: 88,
    at: run.createdAt.toISOString(),
  });
  expect(records.runs.map((r) => r.title).sort()).toEqual(["Checkout keeps the cart", "Plan read model", "Tidy the README"]);
  expect(records.chats.map((c) => [c.title, c.projectId, c.pinned])).toEqual([
    ["Plan the voice epic", handoff.id, true],
    ["Outside any project", null, false],
    ["Why checkout drops the cart", shop.id, false],
  ]);
});

test("a Flow project's runs and chats carry no time", async () => {
  const flow = await project("flowy", { mode: "flow" });
  await flow.run({ task: "One" });
  await db.insert(assistantConversations).values({ title: "A chat", projectId: flow.id });

  const records = await searchRecords(db, { projectId: flow.id });

  expect(records.runs.map((r) => r.at)).toEqual([null]);
  expect(records.chats.map((c) => c.at)).toEqual([null]);
});

test("records keep the latest 200 runs of each project", async () => {
  const p = await project("busy");
  const base = Date.parse("2026-09-01T00:00:00Z");
  const [graph] = await db.select({ id: graphVersions.id }).from(graphVersions).innerJoin(graphs, eq(graphs.id, graphVersions.graphId)).where(eq(graphs.projectId, p.id));
  await db.insert(runs).values(
    Array.from({ length: 205 }, (_, i) => ({
      projectId: p.id,
      graphVersionId: graph!.id,
      task: `Run ${i}`,
      state: {},
      baseBranch: "main",
      branchName: `b/${i}`,
      createdAt: new Date(base + i * 60_000),
    })),
  );

  const records = await searchRecords(db, { projectId: p.id });

  expect(records.runs).toHaveLength(200);
  expect(records.runs[0]!.title).toBe("Run 204");
  expect(records.runs.map((r) => r.title)).not.toContain("Run 4");
});

test("without a project, search covers the one used last, else the first", async () => {
  const a = await project("alpha");
  const b = await project("beta");
  expect((await searchRecords(db, { lastProjectId: b.id })).projectId).toBe(b.id);
  expect((await searchRecords(db, { lastProjectId: "gone" })).projectId).toBe(a.id);
  expect((await searchRecords(db, {})).projects.find((p) => p.current)?.id).toBe(a.id);
});
