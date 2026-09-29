import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
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
    expect(events.map((e) => e.type)).toContain("github.pr");
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
