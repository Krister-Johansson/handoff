import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { FakeCliExecutor, type FakeReply } from "@handoff/cli-adapter/testing";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cliNodeExecutor } from "../executors/cli-node.ts";
import { cancelRun, repairNodeExecution } from "../operations.ts";
import { createRun } from "../runs.ts";
import { createOriginRepo, git } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { runOnce } from "./worker.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const graph = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner" } },
    { key: "coder", attributes: { type: "coder" } },
  ],
  edges: [{ key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done" } }],
};

/** A coder that leaves a file git does not track in the worktree, then gives up. */
const leavesEnvAndFails: FakeReply = async (request, options) => {
  writeFileSync(join(request.cwd, ".env"), "DATABASE_URL=postgres://localhost/app_test\n");
  await options.onSessionId?.(request.session.id);
  const output = { status: "failed", summary: "the tests need a database" };
  return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: output, validated: output };
};

async function failedRun(cli: FakeCliExecutor, workdirs: GitWorktreeProvider) {
  const { project, graphVersion } = await seedGraph(db, graph, { localClonePath: createOriginRepo() });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
  const executors = { planner: scripted(done(outputs.planner, { plan: outputs.planner })), coder: cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 }) };
  const deps = engineDeps(db, executors, { workdirs });
  await drain(deps);
  const { run: row, executions } = await inspect(db, run.id);
  expect(row.status).toBe("failed");
  return { run: row, deps, failed: executions.find((e) => e.nodeKey === "coder")! };
}

/** Lands a commit on origin's main, as a pull request merged elsewhere would. */
function mergeElsewhere(origin: string, file: string) {
  const work = mkdtempSync(join(tmpdir(), "handoff-elsewhere-"));
  git(work, "clone", "-q", origin, ".");
  writeFileSync(join(work, file), "merged elsewhere\n");
  git(work, "add", file);
  git(work, "commit", "-qm", `add ${file}`);
  git(work, "push", "-q", "origin", "main");
}

test("the first coder attempt starts on the latest base when the branch has no commits", async () => {
  const origin = createOriginRepo();
  const plannerOut = { plan: "p", steps: ["s"], ownedPaths: ["CHANGELOG.md"] };
  let coderSaw: boolean | undefined;
  const cli = new FakeCliExecutor([
    async (request, options) => {
      // The worktree exists now, on main as it was; main moves while the plan waits.
      mergeElsewhere(origin, "LICENSE");
      await options.onSessionId?.(request.session.id);
      return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: plannerOut, validated: plannerOut };
    },
    async (request, options) => {
      coderSaw = existsSync(join(request.cwd, "LICENSE"));
      await options.onSessionId?.(request.session.id);
      return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: outputs.coderDone, validated: outputs.coderDone };
    },
  ]);
  const { project, graphVersion } = await seedGraph(db, graph, { localClonePath: origin });
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Add a CHANGELOG.md" });
  const node = cliNodeExecutor({ cli, maxTurns: 20, timeoutMs: 60_000 });
  const workdirs = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
  await drain(engineDeps(db, { planner: node, coder: node }, { workdirs }));
  expect(coderSaw).toBe(true);
  const { types } = await inspect(db, run.id);
  expect(types).toContain("workdir.fast_forwarded");
});

test("a failed run keeps its worktree until it is repaired or cancelled", async () => {
  const workdirs = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
  let sawEnv: boolean | undefined;
  const cli = new FakeCliExecutor([
    leavesEnvAndFails,
    async (request, options) => {
      sawEnv = existsSync(join(request.cwd, ".env"));
      writeFileSync(join(request.cwd, "CHANGELOG.md"), "# Changelog\n");
      git(request.cwd, "add", "CHANGELOG.md");
      git(request.cwd, "commit", "-qm", "changelog");
      await options.onSessionId?.(request.session.id);
      return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: outputs.coderDone, validated: outputs.coderDone };
    },
    leavesEnvAndFails,
  ]);

  // Repaired: the worktree stayed, so the next attempt has what the failed one left in it.
  const repaired = await failedRun(cli, workdirs);
  const kept = workdirs.worktreePath(repaired.run.id);
  expect(repaired.run.worktreePath).toBe(kept);
  await runOnce(repaired.deps);
  expect(existsSync(join(kept, ".env"))).toBe(true);
  await repairNodeExecution(db, repaired.failed.id, {});
  await drain(repaired.deps);
  expect(sawEnv).toBe(true);
  expect((await inspect(db, repaired.run.id)).run.status).toBe("succeeded");
  expect(existsSync(kept)).toBe(false);

  // Cancelled: the worker removes the worktree although no step of the run is left to run.
  const cancelled = await failedRun(cli, workdirs);
  const path = workdirs.worktreePath(cancelled.run.id);
  expect(existsSync(path)).toBe(true);
  await cancelRun(db, cancelled.run.id);
  await runOnce(cancelled.deps);
  expect(existsSync(path)).toBe(false);
  expect((await inspect(db, cancelled.run.id)).run.worktreePath).toBeNull();
});
