import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { RunStateSchema } from "@handoff/core";
import { appendEvents, eq, projects, questions, runs, wakeByKey } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import type { PlanStatus } from "@handoff/github";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { cancelRun, splitRun } from "../operations.ts";
import { createRun } from "../runs.ts";
import { createOriginRepo, git } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import type { ExecutorRegistry, NodeExecutor } from "../types.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { mergeNodeExecutor, prNodeExecutor } from "./github.ts";

const db = createTestDb();
/** The pull request text the coder writes in each attempt; an attempt past the list writes none. */
let prTexts: { title: string; body: string }[] = [];
beforeEach(async () => {
  prTexts = [];
  await truncateAll(db);
});
afterAll(() => db.$client.end());

const repo = { owner: "octo", name: "sample" };

/**
 * The linear graph with a merge node that merges without waiting for a person, and failed CI sending the
 * work back to the coder.
 */
const graph = {
  ...linear,
  nodes: linear.nodes.map((n) => (n.key === "merge" ? { ...n, attributes: { ...n.attributes, config: { mode: "auto" } } } : n)),
  edges: [
    ...linear.edges,
    { key: "pr->coder", source: "pr", target: "coder", attributes: { loop: true, maxAttempts: 3, condition: { eq: ["node.output.feedback.ci.status", "failure"] } } },
  ],
};

const plannerOut = { plan: "p", steps: [], ownedPaths: ["CHANGELOG.md"] };
const planner: NodeExecutor = { needsWorkdir: false, execute: async () => ({ kind: "completed", output: plannerOut, statePatch: { plan: plannerOut } }) };
const coder: NodeExecutor = {
  needsWorkdir: true,
  execute: async (ctx) => {
    writeFileSync(join(ctx.workdir!.path, "CHANGELOG.md"), `# Changelog of run ${ctx.run.id}, attempt ${ctx.execution.attempt}\n`);
    git(ctx.workdir!.path, "add", "-A");
    git(ctx.workdir!.path, "commit", "-qm", "Add changelog");
    const pr = prTexts[ctx.execution.attempt - 1];
    return { kind: "completed", output: { status: "done", summary: "Added CHANGELOG.md", ...(pr ? { pr } : {}) } };
  },
};

/** Whether GitHub reads a closing keyword in front of the issue anywhere in the description. */
const closes = (body: string, issue: number) =>
  new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?):?\\s+(#|octo/sample#|https://github\\.com/octo/sample/issues/)${issue}(?!\\d)`, "i").test(body);

/**
 * A project with a plan, where GitHub closes the issues a merged pull request names with Closes. `task`
 * opens a task on the plan; `start` starts a run on one and drains it to its pull request waiting on CI;
 * `split` splits a run at its plan gate the way "Split as proposed" does, into the run's own part and a
 * task for each later part, each blocked by the one before.
 */
async function planned() {
  const origin = createOriginRepo();
  const github = new FakeGitHub();
  github.closesOnMerge = true;
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "sample plan");
  const { project, graphVersion } = await seedGraph(db, graph, { localClonePath: origin });
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));
  const executors: ExecutorRegistry = { planner, coder, pr: prNodeExecutor({ github, db, projects: plan }), merge: mergeNodeExecutor({ github, db, projects: plan }) };
  const deps = engineDeps(db, executors, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) });

  const task = async (title: string, blockedBy?: number) => {
    const created = await plan.createIssue(repo, { project: number, title, body: "", labels: ["task"], ...(blockedBy ? { blockedBy: [blockedBy] } : {}) });
    plan.itemsOf(repo).get(created.number)!.status = "Ready";
    return created.number;
  };
  const state = (n: number) => github.issues.get(n)!.state;
  const statusOf = (n: number): Promise<PlanStatus | undefined> => plan.getStatus(repo, number, n);

  /** Starts a run on `issue`, which goes Running, and drains it to its pull request waiting on CI. */
  const start = async (issue: number) => {
    plan.itemsOf(repo).get(issue)!.status = "Running";
    const { title, url } = github.issues.get(issue)!;
    const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: title, issues: [{ number: issue, title, url, body: "" }] });
    return run;
  };
  /** The run's pull request, once it has one. */
  const prOf = async (runId: string) => {
    const { run } = await inspect(db, runId);
    return github.prs.get(run.prNumber!)!;
  };
  /** CI passes on the run's pull request and the merge node merges it. */
  const merge = async (runId: string) => {
    const { run } = await inspect(db, runId);
    github.setChecks(run.prNumber!, "SUCCESS");
    await wakeByKey(db, `gh:pr:42:${run.prNumber}`, { reason: "webhook" });
    await drain(deps);
  };
  /** Splits the run on `issue` into its own part and `later` more parts, through the plan gate's split; returns the parts' issues. */
  const split = async (runId: string, issue: number, later: string[]) => {
    const parts: number[] = [];
    for (const title of later) parts.push(await task(title, parts.at(-1) ?? issue));
    for (const part of parts) plan.itemsOf(repo).get(part)!.status = "Shaping";
    const proposed = [{ title: "First part", body: "The first part.", ownedPaths: ["CHANGELOG.md"] }, ...later.map((title) => ({ title, body: title, ownedPaths: ["src/x.ts"] }))];
    const gate = await seedExecution(db, runId, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "passed" });
    const [question] = await db
      .insert(questions)
      .values({ runId, nodeExecutionId: gate.id, question: "Review the split from planner", options: ["split", "changes"], context: { reason: "approval", split: { parts: proposed } } })
      .returning();
    await splitRun(db, question!.id, { answeredBy: "krister", issues: parts.map((n) => ({ number: n, title: github.issues.get(n)!.title, url: github.issues.get(n)!.url })) });
    return parts;
  };
  /** Records a split the way handoff did before runs kept `splitOf`: only the `run.split` event. */
  const splitBefore = async (runId: string, issue: number, later: string[]) => {
    const parts: number[] = [];
    for (const title of later) parts.push(await task(title, parts.at(-1) ?? issue));
    const issues = parts.map((n) => ({ number: n, title: github.issues.get(n)!.title, url: github.issues.get(n)!.url }));
    await db.transaction((tx) => appendEvents(tx, runId, [{ type: "run.split", payload: { questionId: "q", task: "First part", issues, dropped: [] } }]));
    return parts;
  };
  /** Cancels the run and starts it again with its task, issues and split, as running a failed run again does. */
  const again = async (runId: string) => {
    const { run } = await inspect(db, runId);
    await cancelRun(db, runId, { reason: "run again" });
    const { issues, splitOf } = RunStateSchema.parse(run.state);
    const next = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: run.task, issues: issues ?? [], splitOf });
    await db.update(runs).set({ supersededBy: next.id }).where(eq(runs.id, runId));
    return next;
  };
  const events = async (runId: string, type: string) => (await inspect(db, runId)).events.filter((e) => e.type === type).map((e) => e.payload);
  return { github, plan, deps, task, state, statusOf, start, prOf, merge, split, splitBefore, again, events };
}

describe("a split run", () => {
  test("its pull request says Part of the original issue and does not close it, and its merge leaves the issue open and not Done", async () => {
    const { deps, task, state, statusOf, start, prOf, merge, split, github } = await planned();
    const original = await task("Add a board");
    const run = await start(original);
    const [drag] = await split(run.id, original, ["Drag cards"]);
    await drain(deps);

    const body = (await prOf(run.id)).body;
    expect(body).toContain(`Part of #${original}`);
    expect(body).not.toMatch(new RegExp(`Closes #${original}\\b`));

    await merge(run.id);
    expect(github.merged).toHaveLength(1);
    expect(state(original)).toBe("open");
    expect(github.closedIssues).toEqual([]);
    expect(await statusOf(original)).toBe("In review");
    // The next part waited for this one only; it no longer waits on the original issue, which stays open.
    expect(await github.openBlockers(repo, drag!)).toEqual([]);
  });

  test("a coder's description that puts a closing keyword in front of the original issue opens a pull request GitHub does not read as closing it", async () => {
    const { deps, task, start, prOf, split } = await planned();
    const original = await task("Add a board");
    const run = await start(original);
    await split(run.id, original, ["Drag cards"]);
    prTexts = [
      {
        title: "Show todos as a board",
        body: `Shows the board. It does not close #${original}.\nCloses #${original}\nFixes: octo/sample#${original} later, and RESOLVES https://github.com/octo/sample/issues/${original} too. Keeps #${original}0 apart.`,
      },
    ];
    await drain(deps);

    const body = (await prOf(run.id)).body;
    expect(closes(body, original)).toBe(false);
    expect(body).toContain(`It does not close issue #${original}.`);
    expect(body).toContain(`Part of #${original}`);
  });

  test("a later round's description with a closing keyword in front of the original issue updates the pull request without it", async () => {
    const { deps, task, start, prOf, split, github } = await planned();
    const original = await task("Add a board");
    const run = await start(original);
    await split(run.id, original, ["Drag cards"]);
    prTexts = [
      { title: "Show todos as a board", body: "First round." },
      { title: "Show todos as a board", body: `Second round. This does not fix #${original}; the later parts do.` },
    ];
    await drain(deps);
    const { run: row } = await inspect(db, run.id);
    github.setChecks(row.prNumber!, "FAILURE");
    await wakeByKey(db, `gh:pr:42:${row.prNumber}`, { reason: "webhook" });
    await drain(deps);

    const body = (await prOf(run.id)).body;
    expect(body).toContain("Second round.");
    expect(closes(body, original)).toBe(false);
    expect(body).toContain(`Part of #${original}`);
  });

  test("merging the last part's run closes the original issue with a comment naming the parts, and sets it Done", async () => {
    const { deps, task, state, statusOf, start, merge, split, github, events } = await planned();
    const original = await task("Add a board");
    const first = await start(original);
    const [drag, filter] = await split(first.id, original, ["Drag cards", "Filter cards"]);
    await drain(deps);
    await merge(first.id);

    const second = await start(drag!);
    await drain(deps);
    await merge(second.id);
    expect(state(drag!)).toBe("closed");
    expect(state(original)).toBe("open");

    const third = await start(filter!);
    await drain(deps);
    await merge(third.id);
    expect(state(filter!)).toBe("closed");
    expect(state(original)).toBe("closed");
    const comment = github.closedIssues.find((c) => c.number === original)!.comment;
    expect(comment).toContain(`#${drag}, #${filter}`);
    expect(comment).toContain(first.id);
    expect(await statusOf(original)).toBe("Done");
    expect(await events(third.id, "github.splits_closed")).toEqual([{ numbers: [original] }]);
  });

  test("a part closed by hand counts, so the split run's merge closes the original issue when the parts are closed already", async () => {
    const { deps, task, state, statusOf, start, merge, split, github } = await planned();
    const original = await task("Add a board");
    const run = await start(original);
    const [drag] = await split(run.id, original, ["Drag cards"]);
    await drain(deps);
    github.issues.get(drag!)!.state = "closed";

    await merge(run.id);
    expect(state(original)).toBe("closed");
    expect(await statusOf(original)).toBe("Done");
  });

  test("a part that was split again closes when its own parts are done, and then the original issue closes", async () => {
    const { deps, task, state, start, merge, split } = await planned();
    const original = await task("Add a board");
    const first = await start(original);
    const [drag] = await split(first.id, original, ["Drag cards"]);
    await drain(deps);
    await merge(first.id);

    const second = await start(drag!);
    const [drop] = await split(second.id, drag!, ["Drop cards"]);
    await drain(deps);
    await merge(second.id);
    expect([drag, original].map((n) => state(n!))).toEqual(["open", "open"]);

    const third = await start(drop!);
    await drain(deps);
    await merge(third.id);
    expect([drop, drag, original].map((n) => state(n!))).toEqual(["closed", "closed", "closed"]);
  });
});

describe("a split run run again", () => {
  test("the original issue closes with the last part when the run that took the split run's place merged part 1", async () => {
    const { deps, task, state, start, merge, split, again } = await planned();
    const original = await task("Add a board");
    const first = await start(original);
    const [drag] = await split(first.id, original, ["Drag cards"]);
    const second = await again(first.id);
    await drain(deps);
    await merge(second.id);
    expect(state(original)).toBe("open");

    const third = await start(drag!);
    await drain(deps);
    await merge(third.id);
    expect(state(original)).toBe("closed");
  });
});

describe("a run split before runs kept splitOf", () => {
  test("its pull request says Part of the original issue, and its merge leaves the issue open and unblocks the next part", async () => {
    const { deps, task, state, statusOf, start, prOf, merge, splitBefore, github } = await planned();
    const original = await task("Add a board");
    const run = await start(original);
    const [drag] = await splitBefore(run.id, original, ["Drag cards"]);
    await drain(deps);

    const body = (await prOf(run.id)).body;
    expect(body).toContain(`Part of #${original}`);
    expect(body).not.toMatch(new RegExp(`Closes #${original}\\b`));
    await merge(run.id);
    expect(state(original)).toBe("open");
    expect(await statusOf(original)).toBe("In review");
    expect(await github.openBlockers(repo, drag!)).toEqual([]);
  });

  test("a pull request opened with Closes for the original issue no longer closes it at the merge, and the last part's merge does", async () => {
    const { deps, task, state, statusOf, start, prOf, merge, splitBefore, github } = await planned();
    const original = await task("Add a board");
    const first = await start(original);
    await drain(deps);
    expect((await prOf(first.id)).body).toContain(`Closes #${original}`);
    const [drag] = await splitBefore(first.id, original, ["Drag cards"]);

    await merge(first.id);
    const body = (await prOf(first.id)).body;
    expect(body).toContain(`Part of #${original}`);
    expect(body).not.toMatch(new RegExp(`Closes #${original}\\b`));
    expect(state(original)).toBe("open");
    expect(github.closedIssues).toEqual([]);
    expect(await statusOf(original)).toBe("In review");

    const second = await start(drag!);
    await drain(deps);
    await merge(second.id);
    expect(state(original)).toBe("closed");
    expect(await statusOf(original)).toBe("Done");
  });
});
