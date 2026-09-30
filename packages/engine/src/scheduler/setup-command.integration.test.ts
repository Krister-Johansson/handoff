import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { testerExecutor } from "../executors/tester.ts";
import { createRun } from "../runs.ts";
import { createOriginRepo } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** Two tester steps: the first checks the setup ran, the second counts how often it ran. */
const graph = {
  attributes: { startNode: "first" },
  nodes: [
    { key: "first", attributes: { type: "tester", config: { command: "test -f .setup/ran" }, x: 0, y: 0 } },
    { key: "second", attributes: { type: "tester", config: { command: "test $(wc -l < .setup/ran) -eq 1" }, x: 300, y: 0 } },
  ],
  edges: [{ key: "first->second", source: "first", target: "second", attributes: { port: "pass" } }],
};

async function runWith(setupCommand: string | null) {
  const origin = createOriginRepo({ "README.md": "# sample\n", ".gitignore": ".setup/\n" });
  const { project, graphVersion } = await seedGraph(db, graph, { localClonePath: origin });
  await db.update(projects).set({ setupCommand }).where(eq(projects.id, project.id));
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Check setup" });
  await drain(engineDeps(db, { tester: testerExecutor() }, { workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) }) }));
  return inspect(db, run.id);
}

test("a project's setup command runs once in a run's worktree, before its first step there", async () => {
  const { run, executions, types } = await runWith("mkdir -p .setup && echo once >> .setup/ran");
  expect(executions.map((e) => [e.nodeKey, e.status])).toEqual([
    ["first", "passed"],
    ["second", "passed"],
  ]);
  expect(run.status).toBe("succeeded");
  expect(types.filter((t) => t === "setup.finished")).toHaveLength(1);
});

test("a failing setup command fails the step with its output, and nothing runs after it", async () => {
  const { executions, events } = await runWith("echo cannot install >&2; exit 3");
  expect(executions[0]).toMatchObject({ nodeKey: "first", status: "failed", error: { code: "setup_failed" } });
  expect((executions[0]!.error as { message: string }).message).toContain("cannot install");
  expect(events.find((e) => e.type === "setup.finished")?.payload).toMatchObject({ exitCode: 3 });
});

test("without a setup command nothing extra runs", async () => {
  const { executions, types } = await runWith(null);
  expect(executions[0]).toMatchObject({ nodeKey: "first", status: "passed" });
  expect(types).not.toContain("setup.started");
});
