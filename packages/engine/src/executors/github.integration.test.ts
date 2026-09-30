import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import { wakeByKey } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { createRun } from "../runs.ts";
import { createOriginRepo, git } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import type { ExecutorRegistry, NodeExecutor } from "../types.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
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

async function setup() {
  const origin = createOriginRepo();
  const github = new FakeGitHub();
  const { project, graphVersion } = await seedGraph(db, linear, { localClonePath: origin });
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
    const { github, run, deps } = await setup();
    await drain(deps);
    github.setChecks(1, "SUCCESS");
    github.prs.get(1)!.mergeable = "CONFLICTING";
    await wakeByKey(db, "gh:pr:42:1", { reason: "webhook" });
    await drain(deps);
    const merge = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "merge")!;
    expect(merge).toMatchObject({ status: "failed", error: { code: "merge_failed" } });
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

describe("repositories without CI", () => {
  async function run(prConfig: Record<string, unknown>) {
    const origin = createOriginRepo();
    const github = new FakeGitHub();
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

  test("before the limit a PR with no checks yet keeps waiting, since CI may still be starting", async () => {
    const { github, run: created } = await run({});
    expect(github.merged).toEqual([]);
    expect((await inspect(db, created.id)).executions.find((e) => e.nodeKey === "pr")?.status).toBe("waiting");
  });
});
