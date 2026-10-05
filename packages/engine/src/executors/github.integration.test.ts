import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import { and, eq, nodeExecutions, projects, screenshots, wakeByKey, webhookDeliveries } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import type { CheckContext, PlanStatus, PrSnapshot } from "@handoff/github";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { cancelRun } from "../operations.ts";
import { createRun } from "../runs.ts";
import { createOriginRepo, flakyFetches, git, landOnMain } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import type { ExecutorRegistry, NodeExecutor } from "../types.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { selectContext } from "../context.ts";
import { mergeNodeExecutor, prNodeExecutor } from "./github.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const plannerOut = { plan: "p", steps: [], ownedPaths: ["CHANGELOG.md"] };

const planner: NodeExecutor = { needsWorkdir: false, execute: async () => ({ kind: "completed", output: plannerOut, statePatch: { plan: plannerOut } }) };
const coder: NodeExecutor = {
  needsWorkdir: true,
  execute: async (ctx) => {
    writeFileSync(join(ctx.workdir!.path, "CHANGELOG.md"), `# Changelog attempt ${ctx.execution.attempt}\n`);
    git(ctx.workdir!.path, "add", "-A");
    git(ctx.workdir!.path, "commit", "-qm", "Add changelog");
    return { kind: "completed", output: { status: "done", summary: "Added CHANGELOG.md" } };
  },
};

async function setup(document: unknown = linear) {
  const origin = createOriginRepo();
  const github = new FakeGitHub();
  const { project, graphVersion } = await seedGraph(db, document, { localClonePath: origin });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
  const executors: ExecutorRegistry = { planner, coder, pr: prNodeExecutor({ github }), merge: mergeNodeExecutor({ github }) };
  const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });
  return { origin, github, run, deps };
}

describe("PR node", () => {
  test("PR node pushes the branch, opens a PR and yields waiting on its correlation key", async () => {
    const { origin, github, run, deps } = await setup();
    await drain(deps);
    const { run: row, executions, events } = await inspect(db, run.id);
    const pr = executions.find((e) => e.nodeKey === "pr")!;
    expect(pr.status).toBe("waiting");
    expect(pr.waitKey).toBe("gh:pr:42:1");
    expect(row.status).toBe("waiting");
    expect(git(origin, "log", "--format=%s", "-1", row.branchName)).toBe("Add changelog");
    const opened = github.prs.get(1)!;
    expect(opened).toMatchObject({ headRef: row.branchName, base: "main", title: "Add a CHANGELOG.md" });
    expect(opened.body).toContain("Added CHANGELOG.md");
    // The run knows its PR while the PR node waits for CI, not only once it passes.
    expect(row.prNumber).toBe(1);
    expect(events.map((e) => e.type)).toContain("github.pr");
  });

  test("PR node says in the PR body which linked issues it closes", async () => {
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    const { project, graphVersion } = await seedGraph(db, linear, { localClonePath: origin });
    const issues = [
      { number: 12, title: "Slugify drops digits", url: "https://github.com/octo/sample/issues/12", body: "" },
      { number: 14, title: "Document slugify", url: "https://github.com/octo/sample/issues/14", body: "" },
    ];
    await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Fix slugify", issues });
    const executors: ExecutorRegistry = { planner, coder, pr: prNodeExecutor({ github }), merge: mergeNodeExecutor({ github }) };
    await drain(engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) }));
    const body = github.prs.get(1)!.body;
    expect(body).toContain("Closes #12");
    expect(body).toContain("Closes #14");
  });

  test("PR node resumed with checks success passes and the linear run merges and finishes", async () => {
    const { github, run, deps } = await setup();
    await drain(deps);
    github.setChecks(1, "SUCCESS");
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    const { run: row, executions } = await inspect(db, run.id);
    expect(executions.map((e) => [e.nodeKey, e.status])).toEqual([
      ["planner", "passed"],
      ["coder", "passed"],
      ["pr", "passed"],
      ["merge", "passed"],
    ]);
    expect(github.merged).toEqual([1]);
    expect(row).toMatchObject({ status: "succeeded", prNumber: 1 });
    expect(row.state).toMatchObject({ prNumber: 1, feedback: { ci: { status: "success" } } });
  });

  test("Merge closes the run's linked issues that are still open, pointing at the pull request", async () => {
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    github.issues.set(12, { number: 12, title: "Slugify drops digits", url: "https://github.com/octo/sample/issues/12", body: "", state: "open" });
    github.issues.set(14, { number: 14, title: "Already closed", url: "https://github.com/octo/sample/issues/14", body: "", state: "closed" });
    const { project, graphVersion } = await seedGraph(db, linear, { localClonePath: origin });
    const issues = [...github.issues.values()].map(({ number, title, url }) => ({ number, title, url, body: "" }));
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Fix slugify", issues });
    const deps = engineDeps(db, { planner, coder, pr: prNodeExecutor({ github }), merge: mergeNodeExecutor({ github }) }, {
      workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }),
    });
    await drain(deps);
    github.setChecks(1, "SUCCESS");
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    expect(github.issues.get(12)!.state).toBe("closed");
    expect(github.closedIssues).toEqual([{ number: 12, comment: expect.stringContaining("#1") }]);
    const { events } = await inspect(db, run.id);
    expect(events.find((e) => e.type === "github.issues_closed")?.payload).toEqual({ numbers: [12] });
  });

  test("PR node resumed with checks failure records failure feedback with job logs and the linear run stops", async () => {
    const { github, run, deps } = await setup();
    await drain(deps);
    github.setChecks(1, "FAILURE", [{ name: "test", jobId: 9, log: "AssertionError: boom" }]);
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    const { run: row, executions } = await inspect(db, run.id);
    expect(executions.find((e) => e.nodeKey === "pr")?.status).toBe("passed");
    expect(executions.some((e) => e.nodeKey === "merge")).toBe(false);
    expect(row.status).toBe("failed");
    expect(row.state).toMatchObject({ feedback: { ci: { status: "failure", failedJobs: [{ name: "test", logExcerpt: "AssertionError: boom" }] } } });
    expect(github.merged).toEqual([]);
  });

  test("PR node keeps waiting while checks are pending", async () => {
    const { run, deps } = await setup();
    await drain(deps);
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    const pr = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "pr")!;
    expect(pr.status).toBe("waiting");
  });

  test("with no webhook from the repository since the push, a PR waiting on CI looks again within a minute, not at the ten-minute reconcile", async () => {
    // Runs on 2026-10-02 got no webhook at all (the relay was not running): every green PR waited the full reconcile.
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    const { project, graphVersion } = await seedGraph(db, linear, { localClonePath: origin });
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
    const executors: ExecutorRegistry = { planner, coder, pr: prNodeExecutor({ github, db }), merge: mergeNodeExecutor({ github, db }) };
    const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });
    const prDeadline = async () => (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "pr")!.waitDeadlineAt!.getTime() - Date.now();
    await drain(deps);
    expect(await prDeadline()).toBeLessThanOrEqual(60_000);
    expect(await prDeadline()).toBeGreaterThan(30_000);

    // Once GitHub's webhooks arrive, a webhook wakes the PR node and the reconcile is only the fallback.
    await db.insert(webhookDeliveries).values({ deliveryId: "d1", eventName: "check_suite", action: "requested", repoId: 42, payload: {} });
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    expect(await prDeadline()).toBeGreaterThan(9 * 60_000);
  });

  test("PR node is idempotent when a PR already exists for the branch", async () => {
    const { github, run, deps } = await setup();
    const branch = run.branchName;
    await github.createPr({ owner: "octo", name: "sample" }, { head: branch, base: "main", title: "existing", body: "" });
    await drain(deps);
    expect(github.prs.size).toBe(1);
    expect((await inspect(db, run.id)).executions.find((e) => e.nodeKey === "pr")?.waitKey).toBe("gh:pr:42:1");
  });

  test("a finished run removes its worktree", async () => {
    const { github, run, deps } = await setup();
    await drain(deps);
    github.setChecks(1, "SUCCESS");
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    const { run: row } = await inspect(db, run.id);
    const { existsSync } = await import("node:fs");
    expect(existsSync(row.worktreePath!)).toBe(false);
  });
});

describe("Merge node", () => {
  test("Merge node fails when GitHub refuses the merge", async () => {
    const { github, run, deps } = await setup({ ...linear, edges: linear.edges.filter((e) => e.source !== "merge") });
    await drain(deps);
    github.setChecks(1, "SUCCESS");
    github.prs.get(1)!.mergeable = "CONFLICTING";
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    const merge = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "merge")!;
    // Without an update edge there is nowhere to send it back to.
    expect(merge).toMatchObject({ status: "failed", error: { code: "merge_conflict" } });
  });
});

describe("status on the plan", () => {
  const repo = { owner: "octo", name: "sample" };

  /** A run on two tasks of the project's plan, both Running, with the PR and merge nodes writing to the plan. */
  async function plannedRun() {
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    const plan = new FakeProjects(github);
    const { number } = await plan.createProject("octo", repo, "sample plan");
    const { project, graphVersion } = await seedGraph(db, linear, { localClonePath: origin });
    await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
    const tasks = [];
    for (const title of ["Add the changelog", "Link it from the README"]) {
      const created = await plan.createIssue(repo, { project: number, title, body: "", labels: ["task"] });
      plan.itemsOf(repo).get(created.number)!.status = "Running";
      tasks.push({ number: created.number, title, url: created.url, body: "" });
    }
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md", issues: tasks });
    const executors: ExecutorRegistry = { planner, coder, pr: prNodeExecutor({ github, projects: plan }), merge: mergeNodeExecutor({ github, projects: plan }) };
    const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });
    const statusOf = (n: number) => plan.getStatus(repo, number, n);
    const planEvents = async () => (await inspect(db, run.id)).events.filter((e) => e.type.startsWith("plan.")).map((e) => [e.type, e.payload]);
    return { github, plan, tasks: tasks.map((t) => t.number), run, deps, statusOf, planEvents };
  }

  test("opening the pull request sets each linked task to In review once", async () => {
    const { tasks, deps, statusOf, planEvents, plan } = await plannedRun();
    await drain(deps);
    expect(await Promise.all(tasks.map(statusOf))).toEqual(["In review", "In review"]);
    // A person drags one back on GitHub's board; the PR node waking again on CI news writes nothing.
    plan.itemsOf(repo).get(tasks[0]!)!.status = "Ready";
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    expect(await statusOf(tasks[0]!)).toBe("Ready");
    expect(await planEvents()).toEqual(tasks.map((issue) => ["plan.status", { issue, status: "In review" }]));
  });

  test("the merge sets Done after closing the issues", async () => {
    const { github, tasks, run, deps, statusOf } = await plannedRun();
    await drain(deps);
    github.setChecks(1, "SUCCESS");
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    expect(github.merged).toEqual([1]);
    expect(await Promise.all(tasks.map(statusOf))).toEqual(["Done", "Done"]);
    const { types, events } = await inspect(db, run.id);
    const done = events.filter((e) => e.type === "plan.status" && (e.payload as { status: string }).status === "Done");
    expect(done.map((e) => (e.payload as { issue: number }).issue)).toEqual(tasks);
    expect(types.indexOf("github.issues_closed")).toBeLessThan(types.indexOf("plan.status", types.indexOf("github.merged")));
  });
});

describe("closing a finished story and epic", () => {
  type Setup = { owner?: string; organization?: boolean; planMode?: "flow" | "timeline"; withPlan?: boolean };

  /**
   * A project with a plan Project, a repository owned by a user or an organization, and a way to build an
   * epic, stories and tasks in it. GitHub closes the issues a merged pull request names with Closes.
   */
  async function planned(setup: Setup = {}) {
    const owner = setup.owner ?? "octo";
    const repo = { owner, name: "sample" };
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    github.closesOnMerge = true;
    const plan = new FakeProjects(github);
    if (setup.organization) plan.owners.set(owner, "Organization");
    const { number } = await plan.createProject(owner, repo, "sample plan");
    const { project, graphVersion } = await seedGraph(db, linear, { localClonePath: origin });
    await db
      .update(projects)
      .set({ repoOwner: owner, planProjectNumber: setup.withPlan === false ? null : number, planMode: setup.planMode ?? "flow" })
      .where(eq(projects.id, project.id));
    /** An open issue of the plan with its kind label, under `parent`, in `status`. */
    const issue = async (kind: "epic" | "story" | "task", parent?: number, status: PlanStatus = "Ready") => {
      const created = await plan.createIssue(repo, { project: number, title: `A ${kind}`, body: "", labels: [kind], ...(parent ? { parent } : {}) });
      plan.itemsOf(repo).get(created.number)!.status = status;
      return created.number;
    };
    const close = (n: number) => void (github.issues.get(n)!.state = "closed");
    const state = (n: number) => github.issues.get(n)!.state;
    const statusOf = (n: number) => plan.getStatus(repo, number, n);
    /** Starts a run on `task`, which is Running, and drains it to its pull request waiting on CI. */
    const start = async (task: number) => {
      plan.itemsOf(repo).get(task)!.status = "Running";
      const { title, url } = github.issues.get(task)!;
      const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: title, issues: [{ number: task, title, url, body: "" }] });
      const executors: ExecutorRegistry = { planner, coder, pr: prNodeExecutor({ github, projects: plan }), merge: mergeNodeExecutor({ github, projects: plan }) };
      const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });
      await drain(deps);
      /** CI passes and the merge node merges the pull request. */
      const merge = async () => {
        github.setChecks(1, "SUCCESS");
        await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
        await drain(deps);
      };
      const events = async (type: string) => (await inspect(db, run.id)).events.filter((e) => e.type === type).map((e) => e.payload);
      return { run, merge, events };
    };
    return { github, plan, issue, close, state, statusOf, start };
  }

  const finished = (child: number, runId: string) => `Finished by #1, merged by handoff run \`${runId}\`, which closed #${child}, its last open sub-issue.`;

  test.each(["flow", "timeline"] as const)("in a %s project, the merge that closes a story's last open task closes the story, then the epic, and sets both to Done", async (planMode) => {
    const { github, issue, close, state, statusOf, start } = await planned({ planMode });
    const epic = await issue("epic");
    const story = await issue("story", epic);
    const earlier = await issue("task", story, "Done");
    close(earlier);
    const task = await issue("task", story);
    const otherStory = await issue("story", epic, "Done");
    close(otherStory);
    const direct = await issue("task", epic, "Done");
    close(direct);
    const { run, merge, events } = await start(task);
    await merge();

    expect([task, story, epic].map(state)).toEqual(["closed", "closed", "closed"]);
    // GitHub closed the task from the pull request's Closes; handoff closed the story, then the epic.
    expect(github.closedIssues).toEqual([
      { number: story, comment: finished(task, run.id) },
      { number: epic, comment: finished(story, run.id) },
    ]);
    expect(await events("github.parents_closed")).toEqual([{ numbers: [story, epic] }]);
    expect(await Promise.all([task, story, epic].map(statusOf))).toEqual(["Done", "Done", "Done"]);
    expect(await events("plan.status")).toEqual(
      expect.arrayContaining([
        { issue: story, status: "Done", from: "Ready" },
        { issue: epic, status: "Done", from: "Ready" },
      ]),
    );
  });

  test("an epic whose last open child is a task directly under it closes with that task", async () => {
    const { github, issue, state, statusOf, start } = await planned();
    const epic = await issue("epic", undefined, "Running");
    const task = await issue("task", epic);
    const { run, merge, events } = await start(task);
    await merge();
    expect(state(epic)).toBe("closed");
    expect(github.closedIssues).toEqual([{ number: epic, comment: finished(task, run.id) }]);
    expect(await statusOf(epic)).toBe("Done");
    expect(await events("plan.status")).toContainEqual({ issue: epic, status: "Done", from: "Running" });
  });

  test("a story with another open task stays open, and so does its epic", async () => {
    const { github, issue, state, statusOf, start } = await planned();
    const epic = await issue("epic");
    const story = await issue("story", epic);
    const task = await issue("task", story);
    await issue("task", story);
    const { merge, events } = await start(task);
    await merge();
    expect([task, story, epic].map(state)).toEqual(["closed", "open", "open"]);
    expect(github.closedIssues).toEqual([]);
    expect(await events("github.parents_closed")).toEqual([]);
    expect(await statusOf(story)).toBe("Ready");
  });

  test("a task closed by hand before the merge closes no story", async () => {
    const { github, issue, close, state, start } = await planned();
    const epic = await issue("epic");
    const story = await issue("story", epic);
    const task = await issue("task", story);
    const { merge, events } = await start(task);
    // A person closes the task on GitHub while its pull request waits for CI.
    close(task);
    await merge();
    expect(github.merged).toEqual([1]);
    expect([story, epic].map(state)).toEqual(["open", "open"]);
    expect(github.closedIssues).toEqual([]);
    expect(await events("github.parents_closed")).toEqual([]);
  });

  test("a cancelled run closes no story", async () => {
    const { github, plan, issue, close, state, statusOf, start } = await planned();
    const epic = await issue("epic");
    const story = await issue("story", epic);
    const task = await issue("task", story);
    const { run, events } = await start(task);
    await cancelRun(db, run.id, { projects: plan });
    // Closing the task by hand afterwards is no merge of handoff's either.
    close(task);
    expect(github.merged).toEqual([]);
    expect([story, epic].map(state)).toEqual(["open", "open"]);
    expect(github.closedIssues).toEqual([]);
    expect(await events("github.parents_closed")).toEqual([]);
    expect(await statusOf(story)).toBe("Ready");
  });

  test("a story GitHub refuses to close is recorded as an event, and the merge still passes", async () => {
    const { github, issue, state, statusOf, start } = await planned();
    const epic = await issue("epic");
    const story = await issue("story", epic);
    const task = await issue("task", story);
    const close = github.closeIssue.bind(github);
    github.closeIssue = async (repo, number, comment) => {
      if (number === story) throw new Error("Resource not accessible by integration");
      return close(repo, number, comment);
    };
    const { run, merge, events } = await start(task);
    await merge();
    const { run: row, executions } = await inspect(db, run.id);
    expect(executions.find((e) => e.nodeKey === "merge")?.status).toBe("passed");
    expect(row.status).toBe("succeeded");
    expect(await events("github.parent_close_failed")).toEqual([{ parent: story, child: task, message: "Resource not accessible by integration" }]);
    expect([task, story, epic].map(state)).toEqual(["closed", "open", "open"]);
    expect(await statusOf(task)).toBe("Done");
    expect(await statusOf(story)).toBe("Ready");
  });

  test("in an organization's Project, the story and the epic get Done with the Status they had", async () => {
    const { github, issue, state, statusOf, start } = await planned({ owner: "acme", organization: true });
    const epic = await issue("epic", undefined, "Shaping");
    const story = await issue("story", epic, "Running");
    const task = await issue("task", story);
    const { merge, events } = await start(task);
    await merge();
    expect([story, epic].map(state)).toEqual(["closed", "closed"]);
    expect(github.closedIssues.map((c) => c.number)).toEqual([story, epic]);
    expect(await Promise.all([story, epic].map(statusOf))).toEqual(["Done", "Done"]);
    expect(await events("plan.status")).toEqual(
      expect.arrayContaining([
        { issue: story, status: "Done", from: "Running" },
        { issue: epic, status: "Done", from: "Shaping" },
      ]),
    );
  });

  test("without a plan Project, the story and the epic still close on GitHub", async () => {
    const { github, issue, state, start } = await planned({ withPlan: false });
    const epic = await issue("epic");
    const story = await issue("story", epic);
    const task = await issue("task", story);
    const { merge, events } = await start(task);
    await merge();
    expect([task, story, epic].map(state)).toEqual(["closed", "closed", "closed"]);
    expect(github.closedIssues.map((c) => c.number)).toEqual([story, epic]);
    expect(await events("plan.status")).toEqual([]);
    expect(await events("plan.skipped")).toEqual([]);
  });
});

/** The linear graph, whose refused merge goes back to the PR node, with fix (which takes conflicts) back to the coder too. */
const withSyncEdges = (document: typeof linear) => ({
  ...document,
  edges: [...document.edges, { key: "pr->coder:fix", source: "pr", target: "coder", attributes: { port: "fix", input: "feedback", loop: true, maxAttempts: 2 } }],
});

async function syncSetup(document: unknown, onMain: (origin: string) => void, seen: { conflict?: unknown } = {}) {
  const origin = createOriginRepo();
  const github = new FakeGitHub();
  const { project, graphVersion } = await seedGraph(db, document, { localClonePath: origin });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
  // Main moves after the run branched off it, while the coder works.
  const movingCoder: NodeExecutor = {
    needsWorkdir: true,
    execute: async (ctx) => {
      if (ctx.execution.attempt === 1) onMain(origin);
      // What the coder would be told on this attempt.
      else seen.conflict = selectContext(ctx.node, ctx.state, ctx.execution).conflict;
      return coder.execute(ctx);
    },
  };
  const executors: ExecutorRegistry = { planner, coder: movingCoder, pr: prNodeExecutor({ github }), merge: mergeNodeExecutor({ github }) };
  const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });
  return { origin, github, run, deps };
}

describe("keeping up with main", () => {
  test("the PR node merges main into the branch before pushing, so the pull request starts up to date", async () => {
    const { origin, run, deps } = await syncSetup(linear, (o) => landOnMain(o, "LICENSE", "MIT\n"));
    await drain(deps);
    const { run: row, executions, events } = await inspect(db, run.id);
    expect(executions.find((e) => e.nodeKey === "pr")!.status).toBe("waiting");
    // The pushed branch holds main's new commit and the run's own.
    expect(git(origin, "show", `${row.branchName}:LICENSE`)).toBe("MIT");
    expect(git(origin, "show", `${row.branchName}:CHANGELOG.md`)).toBe("# Changelog attempt 1");
    expect(git(origin, "merge-base", "--is-ancestor", "main", row.branchName)).toBe("");
    expect(events.find((e) => e.type === "github.synced")?.payload).toMatchObject({ merged: true });
  });

  test("a conflict with main goes back on the fix edge with the conflicting files, and nothing is pushed", async () => {
    const seen: { conflict?: unknown } = {};
    const { origin, github, run, deps } = await syncSetup(withSyncEdges(linear), (o) => landOnMain(o, "CHANGELOG.md", "# Changelog from main\n"), seen);
    await drain(deps);
    const { run: row, executions } = await inspect(db, run.id);
    // The coder sent back learns what conflicts and with which commit of main.
    expect(seen.conflict).toMatchObject({ base: "main", files: ["CHANGELOG.md"], baseSha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    const pr = executions.find((e) => e.nodeKey === "pr" && e.attempt === 1)!;
    expect(pr.error).toBeNull();
    expect(pr.status).toBe("passed");
    expect(pr.output).toMatchObject({ sync: "conflict", conflict: { files: ["CHANGELOG.md"] } });
    // The coder is sent back to resolve it; the branch never reached GitHub.
    expect(executions.some((e) => e.nodeKey === "coder" && e.attempt === 2)).toBe(true);
    expect(github.prs.size).toBe(0);
    expect(() => git(origin, "rev-parse", "--verify", "-q", row.branchName)).toThrow();
  });

  test("without a fix edge the PR node fails and names the conflicting files", async () => {
    const { run, deps } = await syncSetup(linear, (o) => landOnMain(o, "CHANGELOG.md", "# Changelog from main\n"));
    await drain(deps);
    const pr = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "pr")!;
    expect(pr).toMatchObject({ status: "failed", error: { code: "merge_conflict" } });
    expect(pr.error?.message).toContain("CHANGELOG.md");
  });

  test("a merge GitHub refuses for conflicts goes back to the PR node to catch up with main", async () => {
    const { github, run, deps } = await syncSetup(withSyncEdges(linear), () => {});
    await drain(deps);
    github.setChecks(1, "SUCCESS");
    github.prs.get(1)!.mergeable = "CONFLICTING";
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    const { executions } = await inspect(db, run.id);
    expect(executions.find((e) => e.nodeKey === "merge")).toMatchObject({ status: "passed", output: { merged: false, needsUpdate: true } });
    expect(executions.some((e) => e.nodeKey === "pr" && e.attempt === 2)).toBe(true);
  });
});

describe("network git commands", () => {
  test("a fetch that fails twice and then succeeds does not fail the step", async () => {
    const origin = createOriginRepo();
    const flaky = flakyFetches(2);
    // GitHub's git credentials are where the PR node gets its git config from.
    const github = new FakeGitHub();
    github.gitAuthEnv = async () => flaky.env;
    const { project, graphVersion } = await seedGraph(db, linear, { localClonePath: origin });
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
    const executors: ExecutorRegistry = { planner, coder, pr: prNodeExecutor({ github, gitRetryMs: 10 }), merge: mergeNodeExecutor({ github }) };
    await drain(engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) }));
    const { run: row, executions } = await inspect(db, run.id);
    expect(flaky.tried()).toBe(3);
    expect(executions.find((e) => e.nodeKey === "pr")).toMatchObject({ status: "waiting", error: null });
    expect(git(origin, "log", "--format=%s", "-1", row.branchName)).toBe("Add changelog");
  });
});

describe("repository id", () => {
  test("the PR node stores the repository id on the project the first time it looks it up", async () => {
    const { deps } = await setup();
    await drain(deps);
    const { projects } = await import("@handoff/db");
    const [project] = await db.select().from(projects);
    expect(project?.repoId).toBe(42);
  });
});

describe("Reviewer notes on the pull request", () => {
  const reviewerSaying = (...rounds: { path: string; line?: number; body: string }[][]): NodeExecutor => {
    let call = 0;
    return { needsWorkdir: false, execute: async () => ({ kind: "completed", output: { verdict: "approve", comments: rounds[Math.min(call++, rounds.length - 1)] } }) };
  };
  const tester: NodeExecutor = { needsWorkdir: false, execute: async () => ({ kind: "completed", output: { passed: true, command: "true", exitCode: 0, tail: "" } }) };

  async function setupLoop(reviewer: NodeExecutor) {
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    const { project, graphVersion } = await seedGraph(db, loop, { localClonePath: origin });
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
    const executors: ExecutorRegistry = { planner, coder, tester, reviewer, pr: prNodeExecutor({ github }), merge: mergeNodeExecutor({ github }) };
    const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });
    return { github, run, deps };
  }

  test("PR node posts the Reviewer's comments on the pull request and updates that comment on the next attempt", async () => {
    const { github, run, deps } = await setupLoop(
      reviewerSaying([{ path: "src/slugify.js", line: 4, body: "Nit: name the regex." }], [{ path: "README.md", body: "Nit: typo in Usage." }]),
    );
    await drain(deps);
    let comments = github.prs.get(1)!.comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain("`src/slugify.js:4`");
    expect(comments[0]!.body).toContain("Nit: name the regex.");

    github.setChecks(1, "FAILURE", [{ name: "test", jobId: 9, log: "boom" }]);
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    comments = github.prs.get(1)!.comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain("Nit: typo in Usage.");
    expect(comments[0]!.body).not.toContain("name the regex");

    const { run: row } = await inspect(db, run.id);
    expect(JSON.stringify(row.state.feedback)).not.toContain("typo in Usage");
  });

  test("PR node posts nothing when the Reviewer left no comments", async () => {
    const { github, deps } = await setupLoop(reviewerSaying([]));
    await drain(deps);
    expect(github.prs.get(1)!.comments).toEqual([]);
  });
});

describe("external reviewers", () => {
  const graph = (prConfig: Record<string, unknown>) => ({
    attributes: { startNode: "planner" },
    nodes: [
      { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
      { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
      { key: "pr", attributes: { type: "pr", config: prConfig, x: 0, y: 0 } },
      { key: "merge", attributes: { type: "merge", x: 0, y: 0 } },
    ],
    edges: [
      { key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done" } },
      { key: "coder->pr", source: "coder", target: "pr", attributes: { port: "done" } },
      { key: "pr->merge", source: "pr", target: "merge", attributes: { port: "ready" } },
      { key: "pr->coder", source: "pr", target: "coder", attributes: { port: "fix", input: "feedback" } },
    ],
  });
  async function reviewed(prConfig: Record<string, unknown>) {
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    github.origin = origin;
    const { project, graphVersion } = await seedGraph(db, graph(prConfig), { localClonePath: origin });
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
    const executors: ExecutorRegistry = { planner, coder, pr: prNodeExecutor({ github }), merge: mergeNodeExecutor({ github }) };
    const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });
    await drain(deps);
    github.setChecks(1, "SUCCESS");
    const wake = async () => {
      await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
      await drain(deps);
    };
    await wake();
    return { github, run, wake };
  }

  test("the PR node waits for each listed reviewer to review the head commit, then goes on", async () => {
    const { github, run, wake } = await reviewed({ waitForReviewers: ["coderabbitai[bot]"] });
    expect((await inspect(db, run.id)).executions.find((e) => e.nodeKey === "pr")?.status).toBe("waiting");
    github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
    await wake();
    expect(github.merged).toEqual([1]);
  });

  test("a reviewer's unresolved comments go back to the coder once, and a clean review of the fix lets it merge", async () => {
    const { github, run, wake } = await reviewed({ waitForReviewers: ["coderabbitai"] });
    github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED", body: "Actionable comments posted: 1", threads: [{ path: "CHANGELOG.md", line: 1, body: "Say what changed, not just the attempt." }] });
    await wake();

    const { executions } = await inspect(db, run.id);
    const retry = executions.find((e) => e.nodeKey === "coder" && e.attempt === 2)!;
    const comments = (retry.contextPacket as { priorAttempt?: { reviewComments: { author: string; body: string; path?: string }[] } }).priorAttempt?.reviewComments;
    expect(comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ author: "coderabbitai", path: "CHANGELOG.md", body: "Say what changed, not just the attempt." }),
        expect.objectContaining({ author: "coderabbitai", body: "Actionable comments posted: 1" }),
      ]),
    );
    // The fix is pushed and waits for coderabbitai again, on the new head commit.
    expect(executions.filter((e) => e.nodeKey === "pr").at(-1)?.status).toBe("waiting");
    github.setChecks(1, "SUCCESS");
    github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
    await wake();
    // The first thread is still unresolved on GitHub, but it was already sent back.
    expect(github.merged).toEqual([1]);
  });

  test("a reviewer who never shows up does not hold the run past the time limit", async () => {
    const { github, run } = await reviewed({ waitForReviewers: ["copilot-pull-request-reviewer[bot]"], reviewTimeoutMinutes: 0 });
    expect(github.merged).toEqual([1]);
    expect((await inspect(db, run.id)).types).toContain("github.reviewers_timeout");
  });
});

describe("a reviewer's own check", () => {
  const graph = (prConfig: Record<string, unknown>) => ({
    attributes: { startNode: "planner" },
    nodes: [
      { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
      { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
      { key: "pr", attributes: { type: "pr", config: prConfig, x: 0, y: 0 } },
      { key: "merge", attributes: { type: "merge", x: 0, y: 0 } },
    ],
    edges: [
      { key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done" } },
      { key: "coder->pr", source: "coder", target: "pr", attributes: { port: "done" } },
      { key: "pr->merge", source: "pr", target: "merge", attributes: { port: "ready" } },
      { key: "pr->coder", source: "pr", target: "coder", attributes: { port: "fix", input: "feedback" } },
    ],
  });
  const ci = (conclusion: string | null): CheckContext => ({ name: "test", status: conclusion ? "COMPLETED" : "IN_PROGRESS", conclusion, url: "https://ci/7", checkRunId: 7 });
  const coderabbit = (conclusion: string | null): CheckContext => ({ name: "CodeRabbit", status: conclusion ? "COMPLETED" : "IN_PROGRESS", conclusion, url: "https://coderabbit.ai", checkRunId: 8 });

  /** A run whose PR node waits on GitHub, with the head commit's checks as given. */
  async function checked(prConfig: Record<string, unknown>, checks: NonNullable<PrSnapshot["checks"]>) {
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    github.origin = origin;
    const { project, graphVersion } = await seedGraph(db, graph(prConfig), { localClonePath: origin });
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
    const deps = engineDeps(db, { planner, coder, pr: prNodeExecutor({ github }), merge: mergeNodeExecutor({ github }) }, {
      workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }),
    });
    await drain(deps);
    github.jobLogs.set(8, "CodeRabbit review failed");
    github.prs.get(1)!.checks = checks;
    const wake = async () => {
      await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
      await drain(deps);
    };
    /** Moves the PR node's push back in time, as though it had been waiting that long. */
    const pushedAgo = async (minutes: number) => {
      await db
        .update(nodeExecutions)
        .set({ startedAt: new Date(Date.now() - minutes * 60_000) })
        .where(and(eq(nodeExecutions.runId, run.id), eq(nodeExecutions.nodeKey, "pr"), eq(nodeExecutions.status, "waiting")));
    };
    const pr = async () => (await inspect(db, run.id)).executions.filter((e) => e.nodeKey === "pr").at(-1)!;
    const lastCi = async () => (await inspect(db, run.id)).events.filter((e) => e.type === "github.pr").at(-1)?.payload;
    await wake();
    return { github, run, wake, pushedAgo, pr, lastCi };
  }

  test("a pending check named after a listed reviewer is not CI pending: the PR node waits for the review until the time limit, then goes on", async () => {
    const { github, run, wake, pushedAgo, pr, lastCi } = await checked(
      { waitForReviewers: ["coderabbitai[bot]"], reviewTimeoutMinutes: 5 },
      { state: "PENDING", contexts: [ci("SUCCESS"), coderabbit(null)] },
    );
    expect((await pr()).status).toBe("waiting");
    expect(await lastCi()).toMatchObject({ ci: "success" });
    // It wakes at the review time limit, not at the ten-minute reconcile.
    expect((await pr()).waitDeadlineAt!.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 1_000);
    expect((await inspect(db, run.id)).events.find((e) => e.type === "github.reviewers")?.payload).toMatchObject({ waitingFor: ["coderabbitai[bot]"], timedOut: false });

    await pushedAgo(6);
    await wake();
    expect(github.merged).toEqual([1]);
    expect((await inspect(db, run.id)).types).toContain("github.reviewers_timeout");
  });

  test("a pending check not named after a reviewer still holds the PR as CI pending", async () => {
    const { github, wake, pushedAgo, pr, lastCi } = await checked(
      { waitForReviewers: ["coderabbitai[bot]"], reviewTimeoutMinutes: 5 },
      { state: "PENDING", contexts: [ci(null), coderabbit("SUCCESS")] },
    );
    github.reviewOnHead(1, "coderabbitai[bot]", { state: "COMMENTED" });
    await pushedAgo(60);
    await wake();
    expect((await pr()).status).toBe("waiting");
    expect(await lastCi()).toMatchObject({ ci: "pending" });
    expect(github.merged).toEqual([]);
  });

  test("a failed or cancelled reviewer check is not a CI failure sent to the coder", async () => {
    const { github, run, wake } = await checked(
      { waitForReviewers: ["coderabbitai[bot]"], reviewTimeoutMinutes: 5 },
      { state: "FAILURE", contexts: [ci("SUCCESS"), coderabbit("CANCELLED")] },
    );
    github.reviewOnHead(1, "coderabbitai[bot]", { state: "COMMENTED" });
    await wake();
    expect(github.merged).toEqual([1]);
    const { executions, run: row } = await inspect(db, run.id);
    expect(executions.filter((e) => e.nodeKey === "coder")).toHaveLength(1);
    expect(row.state).toMatchObject({ feedback: { ci: { status: "success", failedJobs: [] } } });
  });

  test("without the reviewer in waitForReviewers, its check counts as CI as before", async () => {
    const { github, wake, pushedAgo, pr, lastCi } = await checked({}, { state: "PENDING", contexts: [ci("SUCCESS"), coderabbit(null)] });
    await pushedAgo(60);
    await wake();
    expect((await pr()).status).toBe("waiting");
    expect(await lastCi()).toMatchObject({ ci: "pending" });
    expect(github.merged).toEqual([]);
  });
});

describe("asking a reviewer to start", () => {
  const coderabbit = { waitForReviewers: ["coderabbitai[bot]"] };
  const request = (afterMinutes: number) => ({ reviewRequest: { reviewer: "coderabbitai[bot]", comment: "@coderabbitai review", afterMinutes } });
  const graph = (prConfig: Record<string, unknown>) => ({
    attributes: { startNode: "planner" },
    nodes: [
      { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
      { key: "coder", attributes: { type: "coder", x: 0, y: 0 } },
      { key: "pr", attributes: { type: "pr", config: prConfig, x: 0, y: 0 } },
      { key: "merge", attributes: { type: "merge", x: 0, y: 0 } },
    ],
    edges: [
      { key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done" } },
      { key: "coder->pr", source: "coder", target: "pr", attributes: { port: "done" } },
      { key: "pr->merge", source: "pr", target: "merge", attributes: { port: "ready" } },
      { key: "pr->coder", source: "pr", target: "coder", attributes: { port: "fix", input: "feedback" } },
    ],
  });

  /** A run whose PR node waits on GitHub. Each push starts CI again, as a real repository does. */
  async function opened(prConfig: Record<string, unknown>) {
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    github.origin = origin;
    const { project, graphVersion } = await seedGraph(db, graph(prConfig), { localClonePath: origin });
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
    const pushing: NodeExecutor = {
      needsWorkdir: true,
      execute: async (ctx) => {
        const outcome = await coder.execute(ctx);
        if (github.prs.has(1)) github.setChecks(1, "PENDING");
        return outcome;
      },
    };
    const workdirs = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
    // A fresh executor for each pass, as a restarted worker would have.
    const deps = () => engineDeps(db, { planner, coder: pushing, pr: prNodeExecutor({ github }), merge: mergeNodeExecutor({ github }) }, { workdirs });
    await drain(deps());
    const wake = async () => {
      await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
      await drain(deps());
    };
    /** Moves the PR node's push back in time, as though it had been waiting that long. */
    const pushedAgo = async (minutes: number) => {
      await db
        .update(nodeExecutions)
        .set({ startedAt: new Date(Date.now() - minutes * 60_000) })
        .where(and(eq(nodeExecutions.runId, run.id), eq(nodeExecutions.nodeKey, "pr"), eq(nodeExecutions.status, "waiting")));
    };
    const requests = () => github.prs.get(1)!.comments.filter((c) => c.body.startsWith("@coderabbitai review"));
    return { github, run, wake, pushedAgo, requests };
  }

  test("the PR node comments once to ask a reviewer that has not started, after the delay, and keeps waiting", async () => {
    const { github, run, wake, pushedAgo, requests } = await opened({ ...coderabbit, ...request(2) });
    github.setChecks(1, "SUCCESS");
    await wake();
    expect(requests()).toHaveLength(0);
    // It wakes when the delay is up, not at the ten-minute reconcile.
    const deadline = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "pr")!.waitDeadlineAt!.getTime() - Date.now();
    expect(deadline).toBeGreaterThan(60_000);
    expect(deadline).toBeLessThanOrEqual(2 * 60_000 + 1_000);

    await pushedAgo(3);
    await wake();
    expect(requests()).toHaveLength(1);
    const { executions, events } = await inspect(db, run.id);
    expect(executions.find((e) => e.nodeKey === "pr")?.status).toBe("waiting");
    expect(events.find((e) => e.type === "github.review_requested")?.payload).toMatchObject({ number: 1, reviewer: "coderabbitai[bot]", headSha: github.prs.get(1)!.headSha });

    // Later wakes, by a fresh executor as after a worker restart, do not ask again for the same commit.
    await wake();
    await wake();
    expect(requests()).toHaveLength(1);
    expect((await inspect(db, run.id)).types.filter((t) => t === "github.review_requested")).toHaveLength(1);

    github.reviewOnHead(1, "coderabbitai[bot]", { state: "COMMENTED" });
    await wake();
    expect(github.merged).toEqual([1]);
  });

  test("a reviewer that already reviewed the commit is not asked", async () => {
    const { github, run, wake, pushedAgo, requests } = await opened({ ...coderabbit, ...request(2) });
    github.setChecks(1, "SUCCESS");
    github.reviewOnHead(1, "coderabbitai", { state: "COMMENTED" });
    await pushedAgo(3);
    await wake();
    expect(requests()).toHaveLength(0);
    expect((await inspect(db, run.id)).types).not.toContain("github.review_requested");
    expect(github.merged).toEqual([1]);
  });

  test("a reviewer whose status shows a review in progress is not asked", async () => {
    const { github, wake, pushedAgo, requests } = await opened({ ...coderabbit, ...request(2) });
    github.prs.get(1)!.checks = { state: "PENDING", contexts: [{ name: "CodeRabbit", status: "COMPLETED", conclusion: null, url: "https://coderabbit.ai" }] };
    await pushedAgo(3);
    await wake();
    expect(requests()).toHaveLength(0);
  });

  test("without the setting the PR node never asks", async () => {
    const { github, run, wake, pushedAgo } = await opened(coderabbit);
    github.setChecks(1, "SUCCESS");
    await pushedAgo(3);
    await wake();
    expect(github.prs.get(1)!.comments).toHaveLength(0);
    expect((await inspect(db, run.id)).types).not.toContain("github.review_requested");
  });

  test("after a new push the reviewer is asked again for the new commit, and the request is not sent to the coder as feedback", async () => {
    const { github, run, wake, requests } = await opened({ ...coderabbit, ...request(0) });
    expect(requests()).toHaveLength(1);
    const first = github.prs.get(1)!.headSha;

    // CI fails, so the coder fixes it and pushes a new commit while the reviewer still has not started.
    github.setChecks(1, "FAILURE", [{ name: "test", jobId: 7, log: "1 failing" }]);
    await wake();
    const second = github.prs.get(1)!.headSha;
    expect(second).not.toBe(first);
    expect(requests().map((c) => c.body)).toEqual([expect.stringContaining(first), expect.stringContaining(second)]);

    const { executions } = await inspect(db, run.id);
    const retry = executions.find((e) => e.nodeKey === "coder" && e.attempt === 2)!;
    const comments = (retry.contextPacket as { priorAttempt?: { reviewComments?: { body: string }[] } }).priorAttempt?.reviewComments ?? [];
    expect(comments.map((c) => c.body)).not.toContainEqual(expect.stringContaining("@coderabbitai review"));
  });
});

describe("repositories without CI", () => {
  async function run(prConfig: Record<string, unknown>, opts: { ci?: boolean } = {}) {
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    github.ciConfigured = opts.ci ?? true;
    const doc = structuredClone(linear) as { nodes: { key: string; attributes: Record<string, unknown> }[] };
    doc.nodes.find((n) => n.key === "pr")!.attributes.config = prConfig;
    const { project, graphVersion } = await seedGraph(db, doc, { localClonePath: origin });
    const created = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
    const createPr = github.createPr.bind(github);
    // A repository without workflows: the head commit never gets a check.
    github.createPr = async (repo, input) => {
      const pr = await createPr(repo, input);
      github.prs.get(pr.number)!.checks = null;
      return pr;
    };
    const executors: ExecutorRegistry = { planner, coder, pr: prNodeExecutor({ github }), merge: mergeNodeExecutor({ github }) };
    await drain(engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) }));
    return { github, run: created };
  }

  test("a PR goes on when no check has started on its commit within the limit", async () => {
    const { github, run: created } = await run({ noChecksAfterMinutes: 0 });
    expect(github.merged).toEqual([1]);
    expect((await inspect(db, created.id)).types).toContain("github.no_checks");
  });

  test("a repository with no CI at all goes on at once, without waiting for the limit", async () => {
    const { github, run: created } = await run({}, { ci: false });
    expect(github.merged).toEqual([1]);
    expect((await inspect(db, created.id)).events.find((e) => e.type === "github.no_checks")?.payload).toMatchObject({ reason: "no_ci" });
  });

  test("before the limit a PR with no checks yet keeps waiting, since CI may still be starting", async () => {
    const { github, run: created } = await run({});
    expect(github.merged).toEqual([]);
    expect((await inspect(db, created.id)).executions.find((e) => e.nodeKey === "pr")?.status).toBe("waiting");
  });
});

describe("the pull request's title and body", () => {
  const writer = (...rounds: { title: string; body: string }[]): NodeExecutor => ({
    needsWorkdir: true,
    execute: async (ctx) => {
      writeFileSync(join(ctx.workdir!.path, "CHANGELOG.md"), `# Changelog attempt ${ctx.execution.attempt}\n`);
      git(ctx.workdir!.path, "add", "-A");
      git(ctx.workdir!.path, "commit", "-qm", "Add changelog");
      const pr = rounds[Math.min(ctx.execution.attempt, rounds.length) - 1];
      return { kind: "completed", output: { status: "done", summary: "Added CHANGELOG.md", ...(pr ? { pr } : {}) } };
    },
  });
  const graph = {
    attributes: { startNode: "planner" },
    nodes: [
      { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
      { key: "coder-1", attributes: { type: "coder", x: 0, y: 0 } },
      { key: "pr", attributes: { type: "pr", x: 0, y: 0 } },
      { key: "merge", attributes: { type: "merge", x: 0, y: 0 } },
    ],
    edges: [
      { key: "planner->coder-1", source: "planner", target: "coder-1", attributes: { port: "done" } },
      { key: "coder-1->pr", source: "coder-1", target: "pr", attributes: { port: "done" } },
      { key: "pr->merge", source: "pr", target: "merge", attributes: { port: "ready" } },
      { key: "pr->coder-1", source: "pr", target: "coder-1", attributes: { port: "fix" } },
    ],
  };
  async function opened(coderNode: NodeExecutor) {
    const origin = createOriginRepo();
    const github = new FakeGitHub();
    github.origin = origin;
    const { project, graphVersion } = await seedGraph(db, graph, { localClonePath: origin });
    const run = await createRun(db, {
      projectId: project.id,
      graphVersionId: graphVersion.id,
      task: "Add a CHANGELOG.md",
      issues: [{ number: 12, title: "Changelog", url: "https://github.com/octo/sample/issues/12", body: "" }],
    });
    const deps = engineDeps(db, { planner, coder: coderNode, pr: prNodeExecutor({ github }), merge: mergeNodeExecutor({ github }) }, {
      workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }),
    });
    await drain(deps);
    return { github, deps, run };
  }

  test("the coder's title and body open the pull request, with the issues it closes and no plan", async () => {
    const { github } = await opened(writer({ title: "Add a changelog", body: "Adds CHANGELOG.md with today's entry.\n\nVerified with npm test." }));
    const pr = github.prs.get(1)!;
    expect(pr.title).toBe("Add a changelog");
    expect(pr.body).toContain("Adds CHANGELOG.md with today's entry.");
    expect(pr.body).toContain("Closes #12");
    expect(pr.body).toContain("Opened by handoff run");
    expect(pr.body).not.toContain("## Plan");
  });

  test("without a PR text from the coder, the task is the title and its summary the body", async () => {
    const { github } = await opened(writer());
    const pr = github.prs.get(1)!;
    expect(pr.title).toBe("Add a CHANGELOG.md");
    expect(pr.body).toContain("Added CHANGELOG.md");
    expect(pr.body).not.toContain("## Plan");
  });

  test("a later round that rewrites the PR text updates the pull request", async () => {
    const { github, deps } = await opened(writer({ title: "Add a changelog", body: "First." }, { title: "Add a dated changelog", body: "Second." }));
    github.setChecks(1, "FAILURE");
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    const pr = github.prs.get(1)!;
    expect(pr.title).toBe("Add a dated changelog");
    expect(pr.body).toContain("Second.");
    expect(pr.body).toContain("Closes #12");
  });
});

describe("Screenshots on the pull request", () => {
  /** A coder that also records a screenshot of its work, as a Demo step would. */
  const coderWithShot: NodeExecutor = {
    needsWorkdir: true,
    execute: async (ctx) => {
      const result = await coder.execute(ctx);
      const file = join(mkdtempSync(join(tmpdir(), "shot-")), "0-page-1.png");
      writeFileSync(file, "png bytes");
      await db.insert(screenshots).values({ runId: ctx.run.id, nodeExecutionId: ctx.execution.id, position: 0, path: file, caption: "The new task in the list", criterion: "A user can create a new task", works: true });
      return result;
    },
  };

  async function shotRun(origin = createOriginRepo()) {
    const github = new FakeGitHub();
    const { project, graphVersion } = await seedGraph(db, linear, { localClonePath: origin });
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add tasks" });
    const executors: ExecutorRegistry = { planner, coder: coderWithShot, pr: prNodeExecutor({ github, db }), merge: mergeNodeExecutor({ github }) };
    await drain(engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) }));
    return { github, run, project };
  }

  test("the run's screenshots go to the handoff-assets branch and show in the pull request description", async () => {
    const origin = createOriginRepo();
    const { github, run, project } = await shotRun(origin);
    expect(git(origin, "show", `handoff-assets:runs/${run.id}/0-page-1.png`)).toBe("png bytes");
    const body = github.prs.get(1)!.body;
    expect(body).toContain("## Screenshots");
    expect(body).toContain(`![The new task in the list](https://github.com/${project.repoOwner}/${project.repoName}/blob/handoff-assets/runs/${run.id}/0-page-1.png?raw=true)`);
    expect(body).toContain("A user can create a new task: works");
    // The run's own branch carries none of it.
    expect(git(origin, "ls-tree", "-r", "--name-only", run.branchName)).not.toContain("runs/");
  });

  test("screenshots of earlier runs stay on the assets branch", async () => {
    const origin = createOriginRepo();
    const work = mkdtempSync(join(tmpdir(), "assets-"));
    git(work, "init", "-q", "-b", "handoff-assets");
    git(work, "commit", "-q", "--allow-empty", "-m", "start");
    mkdirSync(join(work, "runs", "earlier"), { recursive: true });
    writeFileSync(join(work, "runs", "earlier", "0-a.png"), "old");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "earlier");
    git(work, "push", "-q", origin, "handoff-assets");
    const { run } = await shotRun(origin);
    expect(git(origin, "ls-tree", "-r", "--name-only", "handoff-assets").split("\n")).toEqual(["runs/earlier/0-a.png", `runs/${run.id}/0-page-1.png`].sort());
  });

  test("a run without screenshots leaves the repository's branches alone", async () => {
    const { origin, github, deps } = await setup();
    await drain(deps);
    expect(() => git(origin, "rev-parse", "--verify", "-q", "handoff-assets")).toThrow();
    expect(github.prs.get(1)!.body).not.toContain("## Screenshots");
  });
});
