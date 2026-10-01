import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { eq, runs, wakeByKey } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { wakeDependents } from "../dependencies.ts";
import { mergeQueue, requestMerge, requestMergeAll } from "../operations.ts";
import { createRun } from "../runs.ts";
import { createOriginRepo, git } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import type { ExecutorRegistry, NodeExecutor } from "../types.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { finishExecutor } from "./flow.ts";
import { mergeNodeExecutor, prNodeExecutor } from "./github.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const plannerOut = { plan: "p", steps: [], ownedPaths: ["**"] };
const planner: NodeExecutor = { needsWorkdir: false, execute: async () => ({ kind: "completed", output: plannerOut, statePatch: { plan: plannerOut } }) };
const coder: NodeExecutor = {
  needsWorkdir: true,
  execute: async (ctx) => {
    writeFileSync(join(ctx.workdir!.path, `${ctx.run.id}.md`), "work\n");
    git(ctx.workdir!.path, "add", "-A");
    git(ctx.workdir!.path, "commit", "-qm", "Work");
    return { kind: "completed", output: { status: "done", summary: "Did the work" } };
  },
};

/** The linear graph with the merge node in `mode`, a Finish after it, and the edge that sends a stale pull request back to catch up. */
const graph = (mode: "manual" | "auto", notify?: Record<string, boolean>) => ({
  ...linear,
  nodes: [
    ...linear.nodes.map((n) =>
      n.key === "merge" ? { ...n, attributes: { ...n.attributes, config: { ...(n.attributes as { config?: object }).config, mode }, ...(notify ? { notify } : {}) } } : n,
    ),
    { key: "finish", attributes: { type: "finish", label: "Finish", config: {}, x: 1200, y: 0 } },
  ],
  edges: [
    ...linear.edges,
    { key: "merge->finish", source: "merge", target: "finish", attributes: { port: "merged" } },
    { key: "merge->pr:update", source: "merge", target: "pr", attributes: { port: "update", input: "in", loop: true, maxAttempts: 2 } },
  ],
});

/** Two runs of one project, each with its pull request open and CI green; the first works on `issues` when given. */
async function twoRuns(mode: "manual" | "auto", issues?: { number: number; title: string; url: string; body: string }[], notify?: Record<string, boolean>) {
  const origin = createOriginRepo();
  const github = new FakeGitHub();
  const { project, graphVersion } = await seedGraph(db, graph(mode, notify), { localClonePath: origin });
  const first = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "First", ...(issues ? { issues } : {}) });
  const second = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Second" });
  const executors: ExecutorRegistry = { planner, coder, pr: prNodeExecutor({ github, db }), merge: mergeNodeExecutor({ github, db }), finish: finishExecutor() };
  const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });
  await drain(deps);
  const prOf = async (runId: string) => (await db.select({ pr: runs.prNumber }).from(runs).where(eq(runs.id, runId)))[0]!.pr!;
  /** CI passes for a run's pull request, which wakes its PR node; the run moves on to the merge node. */
  const ready = async (runId: string) => {
    const number = await prOf(runId);
    github.setChecks(number, "SUCCESS");
    await wakeByKey(db, `gh:pr:42:${number}`, { reason: "webhook" });
    await drain(deps);
  };
  return { github, project, first, second, deps, ready, prOf };
}

const blockedIssue = { number: 7, title: "Board view", url: "https://github.com/octo/sample/issues/7", body: "" };

const mergeStep = async (runId: string) => (await inspect(db, runId)).executions.findLast((e) => e.nodeKey === "merge");

describe("merge queue", () => {
  test("a manual merge waits ready to merge, first in line, until a person asks", async () => {
    const { github, project, first, deps, ready, prOf } = await twoRuns("manual");
    await ready(first.id);
    expect(await mergeStep(first.id)).toMatchObject({ status: "waiting", waitKind: "merge_queue", waitKey: `mq:${project.id}` });
    expect(await mergeQueue(db, project.id)).toMatchObject([{ runId: first.id, position: 1, requested: false, waiting: true }]);
    expect(github.merged).toEqual([]);

    await requestMerge(db, first.id);
    await drain(deps);
    expect(github.merged).toEqual([await prOf(first.id)]);
    expect((await inspect(db, first.id)).run.status).toBe("succeeded");
    expect(await mergeQueue(db, project.id)).toEqual([]);
  });

  test("a pull request that reaches the front and waits for a person says so once", async () => {
    const { project, first, second, deps, ready } = await twoRuns("manual");
    await ready(first.id);
    await ready(second.id);
    // Queue changes wake every waiting run; only the first is ready, and only once.
    await wakeByKey(db, `mq:${project.id}`, { reason: "merge_queue" });
    await drain(deps);
    const readyEvents = async (runId: string) => (await inspect(db, runId)).events.filter((e) => e.type === "merge.ready");
    expect(await readyEvents(first.id)).toHaveLength(1);
    expect((await readyEvents(first.id))[0]!.payload).toMatchObject({ number: expect.any(Number) });
    expect(await readyEvents(second.id)).toHaveLength(0);
  });

  test("the merge node tells a person once that a pull request is ready, and that it merged only when turned on", async () => {
    const notifications = async (runId: string) =>
      (await inspect(db, runId)).events.filter((e) => e.type === "notify" && (e.payload as { kind: string }).kind !== "finished").map((e) => e.payload);
    const quiet = await twoRuns("manual");
    await quiet.ready(quiet.first.id);
    await wakeByKey(db, `mq:${quiet.project.id}`, { reason: "merge_queue" });
    await drain(quiet.deps);
    const number = await quiet.prOf(quiet.first.id);
    expect(await notifications(quiet.first.id)).toEqual([{ kind: "ready", nodeKey: "merge", number }]);
    await requestMerge(db, quiet.first.id);
    await drain(quiet.deps);
    expect(await notifications(quiet.first.id)).toEqual([{ kind: "ready", nodeKey: "merge", number }]);

    await truncateAll(db);
    const told = await twoRuns("manual", undefined, { ready: false, merged: true });
    await told.ready(told.first.id);
    await requestMerge(db, told.first.id);
    await drain(told.deps);
    expect(await notifications(told.first.id)).toEqual([{ kind: "merged", nodeKey: "merge", number: await told.prOf(told.first.id) }]);
  });

  test("a pull request whose issue became blocked on GitHub stays out of the queue until the blocker closes", async () => {
    const { github, project, first, deps, ready } = await twoRuns("manual", [blockedIssue]);
    github.issues.set(5, { number: 5, title: "Theme tokens", url: "u5", body: "", state: "open" });
    github.issues.set(7, { ...blockedIssue, state: "open", blockedBy: [5] });
    await ready(first.id);
    expect(await mergeStep(first.id)).toMatchObject({ status: "waiting", waitKey: `deps:${project.id}` });
    expect(await mergeQueue(db, project.id)).toEqual([]);
    expect((await inspect(db, first.id)).events.find((e) => e.type === "merge.blocked")?.payload).toEqual({ issue: 7, blockedBy: [5] });

    github.issues.get(5)!.state = "closed";
    await wakeDependents(db, project.id);
    await drain(deps);
    expect(await mergeStep(first.id)).toMatchObject({ status: "waiting", waitKey: `mq:${project.id}` });
    expect((await mergeQueue(db, project.id)).map((e) => e.runId)).toEqual([first.id]);
  });

  test("pull requests merge in the order they became ready, even when a later one is asked for first", async () => {
    const { github, project, first, second, deps, ready, prOf } = await twoRuns("manual");
    await ready(first.id);
    await ready(second.id);
    expect((await mergeQueue(db, project.id)).map((e) => [e.runId, e.position])).toEqual([
      [first.id, 1],
      [second.id, 2],
    ]);

    await requestMerge(db, second.id);
    await drain(deps);
    // The second waits behind the first, which nobody asked to merge yet.
    expect(github.merged).toEqual([]);
    expect(await mergeStep(second.id)).toMatchObject({ status: "waiting" });

    await requestMerge(db, first.id);
    await drain(deps);
    expect(github.merged).toEqual([await prOf(first.id), await prOf(second.id)]);
  });

  test("merge all asks for every pull request in the queue, and they land one by one in order", async () => {
    const { github, project, first, second, deps, ready, prOf } = await twoRuns("manual");
    await ready(first.id);
    await ready(second.id);
    await requestMergeAll(db, project.id);
    await drain(deps);
    expect(github.merged).toEqual([await prOf(first.id), await prOf(second.id)]);
  });

  test("auto merge needs nobody, but still waits its turn", async () => {
    const { github, first, second, ready, prOf } = await twoRuns("auto");
    await ready(second.id);
    expect(github.merged).toEqual([await prOf(second.id)]);
    await ready(first.id);
    expect(github.merged).toEqual([await prOf(second.id), await prOf(first.id)]);
  });

  test("a pull request behind main at its turn goes back to catch up, keeps its place, then merges", async () => {
    const { github, project, first, second, deps, ready, prOf } = await twoRuns("manual");
    await ready(first.id);
    await ready(second.id);
    // Main moved since the first pull request's CI ran: the first compare says it is behind, the next not.
    github.behind.set(await prOf(first.id), 1);
    await requestMergeAll(db, project.id);
    await drain(deps);
    const { executions } = await inspect(db, first.id);
    expect(executions.find((e) => e.nodeKey === "merge" && e.attempt === 1)).toMatchObject({ output: { merged: false, needsUpdate: true } });
    expect(executions.some((e) => e.nodeKey === "pr" && e.attempt === 2)).toBe(true);
    // It caught up and still went first.
    expect(github.merged).toEqual([await prOf(first.id), await prOf(second.id)]);
  });
});
