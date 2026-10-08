import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { eq, projects, questions, wakeByKey } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import type { PlanStatus } from "@handoff/github";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { mergeQueue, splitRun } from "../operations.ts";
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

const repo = { owner: "octo", name: "sample" };

/**
 * The linear graph as the editor saves it: the PR node goes on through its ready port to a merge node that
 * waits for a person to ask, then a Finish.
 */
const graph = {
  ...linear,
  nodes: [
    ...linear.nodes.map((n) => (n.key === "merge" ? { ...n, attributes: { ...n.attributes, config: { mode: "manual" } } } : n)),
    { key: "finish", attributes: { type: "finish", label: "Finish", config: {}, x: 1200, y: 0 } },
  ],
  edges: [
    ...linear.edges.map((e) => (e.key === "pr->merge" ? { ...e, attributes: { port: "ready" } } : e)),
    { key: "merge->finish", source: "merge", target: "finish", attributes: { port: "merged" } },
  ],
};

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

/**
 * A project with a plan. `task` opens a task on the plan, `start` starts a run on one and drains it to its
 * pull request waiting on CI, `ready` passes CI so the run waits in the merge queue, and `split` splits a
 * run at its plan gate the way "Split as proposed" does.
 */
async function planned(opts: { closesOnMerge?: boolean } = {}) {
  const github = new FakeGitHub();
  github.closesOnMerge = opts.closesOnMerge ?? false;
  const plan = new FakeProjects(github);
  const { number: planNumber } = await plan.createProject("octo", repo, "sample plan");
  const { project, graphVersion } = await seedGraph(db, graph, { localClonePath: createOriginRepo() });
  await db.update(projects).set({ planProjectNumber: planNumber }).where(eq(projects.id, project.id));
  const executors: ExecutorRegistry = {
    planner,
    coder,
    pr: prNodeExecutor({ github, db, projects: plan }),
    merge: mergeNodeExecutor({ github, db, projects: plan }),
    finish: finishExecutor(),
  };
  const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });

  const task = async (title: string, blockedBy?: number) => {
    const created = await plan.createIssue(repo, { project: planNumber, title, body: "", labels: ["task"], ...(blockedBy ? { blockedBy: [blockedBy] } : {}) });
    plan.itemsOf(repo).get(created.number)!.status = "Ready";
    return created.number;
  };
  const start = async (issue: number) => {
    plan.itemsOf(repo).get(issue)!.status = "Running";
    const { title, url } = github.issues.get(issue)!;
    return createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: title, issues: [{ number: issue, title, url, body: "" }] });
  };
  const prOf = async (runId: string) => (await inspect(db, runId)).run.prNumber!;
  const ready = async (runId: string) => {
    const number = await prOf(runId);
    github.setChecks(number, "SUCCESS");
    await wakeByKey(db, `gh:pr:42:${number}`, { reason: "webhook" });
    await drain(deps);
  };
  const split = async (runId: string, issue: number, later: string[]) => {
    const parts: number[] = [];
    for (const title of later) parts.push(await task(title, parts.at(-1) ?? issue));
    for (const part of parts) plan.itemsOf(repo).get(part)!.status = "Shaping";
    const proposed = [{ title: "First part", body: "The first part.", ownedPaths: ["**"] }, ...later.map((title) => ({ title, body: title, ownedPaths: ["src/x.ts"] }))];
    const gate = await seedExecution(db, runId, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "passed" });
    const [question] = await db
      .insert(questions)
      .values({ runId, nodeExecutionId: gate.id, question: "Review the split from planner", options: ["split", "changes"], context: { reason: "approval", split: { parts: proposed } } })
      .returning();
    await splitRun(db, question!.id, { answeredBy: "krister", issues: parts.map((n) => ({ number: n, title: github.issues.get(n)!.title, url: github.issues.get(n)!.url })) });
    return parts;
  };
  const state = (n: number) => github.issues.get(n)!.state;
  const statusOf = (n: number): Promise<PlanStatus | undefined> => plan.getStatus(repo, planNumber, n);
  const step = async (runId: string, key: string) => (await inspect(db, runId)).executions.findLast((e) => e.nodeKey === key);
  const events = async (runId: string, type: string) => (await inspect(db, runId)).events.filter((e) => e.type === type).map((e) => e.payload);
  return { github, project, deps, task, start, prOf, ready, split, state, statusOf, step, events };
}

describe("a pull request merged by hand", () => {
  test("while the PR step waits on CI, the run goes on as after a merge handoff made: its issue closes, the plan says Done, and the run finishes", async () => {
    const { github, deps, task, start, prOf, state, statusOf, step, events } = await planned();
    const issue = await task("Add a board");
    const run = await start(issue);
    await drain(deps);
    expect(await step(run.id, "pr")).toMatchObject({ status: "waiting" });

    // A person merges it on GitHub while CI still runs, as in run 777f53cb.
    const number = await prOf(run.id);
    github.mergeByHand(number);
    await wakeByKey(db, `gh:pr:42:${number}`, { reason: "webhook" });
    await drain(deps);

    expect((await inspect(db, run.id)).run.status).toBe("succeeded");
    expect(await step(run.id, "pr")).toMatchObject({ status: "passed", output: { merged: true, prNumber: number } });
    expect(await step(run.id, "merge")).toMatchObject({ status: "passed", output: { merged: true } });
    // handoff did not merge it, and says who did.
    expect(github.merged).toEqual([]);
    expect(await events(run.id, "github.merged")).toEqual([{ number, byHand: true }]);
    expect(state(issue)).toBe("closed");
    expect(await statusOf(issue)).toBe("Done");
  });

  test("while its merge step waits in the queue for a person, the run finishes and gives up its place to the next", async () => {
    const { github, project, deps, task, start, prOf, ready, state, statusOf, step } = await planned();
    const issue = await task("Add a board");
    const first = await start(issue);
    const second = await start(await task("Drag cards"));
    await drain(deps);
    await ready(first.id);
    await ready(second.id);
    expect(await step(first.id, "merge")).toMatchObject({ status: "waiting", waitKind: "merge_queue" });
    expect((await mergeQueue(db, project.id)).map((e) => e.runId)).toEqual([first.id, second.id]);

    // A person merges the first on GitHub without asking handoff, as in run 45534cb0; the queue's recheck finds it.
    github.mergeByHand(await prOf(first.id));
    await wakeByKey(db, `mq:${project.id}`, { reason: "timeout" });
    await drain(deps);

    expect((await inspect(db, first.id)).run.status).toBe("succeeded");
    expect(github.merged).toEqual([]);
    expect(state(issue)).toBe("closed");
    expect(await statusOf(issue)).toBe("Done");
    expect(await mergeQueue(db, project.id)).toMatchObject([{ runId: second.id, position: 1 }]);
  });

  test("part 1 of a split merged by hand while its merge step waits in the queue unblocks part 2 from the split issue", async () => {
    const { github, project, deps, task, start, prOf, ready, split, state, events } = await planned({ closesOnMerge: true });
    const original = await task("Add a board");
    const first = await start(original);
    const [drag] = await split(first.id, original, ["Drag cards"]);
    await drain(deps);
    await ready(first.id);
    expect(await github.openBlockers(repo, drag!)).toEqual([original]);

    github.mergeByHand(await prOf(first.id));
    await wakeByKey(db, `mq:${project.id}`, { reason: "timeout" });
    await drain(deps);

    expect((await inspect(db, first.id)).run.status).toBe("succeeded");
    expect(await github.openBlockers(repo, drag!)).toEqual([]);
    expect(await events(first.id, "github.part_unblocked")).toEqual([{ issue: drag, blocker: original }]);
    expect(state(original)).toBe("open");
    expect(github.closedIssues).toEqual([]);
  });

  test("of a split run leaves the split issue open and unblocks the next part, and the last part merged by hand closes it", async () => {
    const { github, project, deps, task, start, prOf, ready, split, state, statusOf } = await planned({ closesOnMerge: true });
    const original = await task("Add a board");
    const first = await start(original);
    const [drag] = await split(first.id, original, ["Drag cards"]);
    await drain(deps);

    github.mergeByHand(await prOf(first.id));
    await wakeByKey(db, `gh:pr:42:${await prOf(first.id)}`, { reason: "webhook" });
    await drain(deps);
    expect((await inspect(db, first.id)).run.status).toBe("succeeded");
    expect(state(original)).toBe("open");
    expect(github.closedIssues).toEqual([]);
    expect(await statusOf(original)).toBe("In review");
    expect(await github.openBlockers(repo, drag!)).toEqual([]);

    const second = await start(drag!);
    await drain(deps);
    await ready(second.id);
    github.mergeByHand(await prOf(second.id));
    await wakeByKey(db, `mq:${project.id}`, { reason: "timeout" });
    await drain(deps);
    expect((await inspect(db, second.id)).run.status).toBe("succeeded");
    expect(state(drag!)).toBe("closed");
    expect(state(original)).toBe("closed");
    expect(await statusOf(original)).toBe("Done");
  });
});
