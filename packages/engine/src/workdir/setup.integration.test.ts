import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { testerExecutor } from "../executors/tester.ts";
import { createRun } from "../runs.ts";
import { createOriginRepo } from "../testing/git.ts";
import { drain, engineDeps, inspect, seedGraph } from "../testing/harness.ts";
import { GitWorktreeProvider } from "./git-worktree.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const graph = (command: string) => ({
  attributes: { startNode: "tests" },
  nodes: [{ key: "tests", attributes: { type: "tester", config: { command }, x: 0, y: 0 } }],
  edges: [],
});

/** Runs one tester step in a real worktree with the project's setup and teardown commands. */
async function runWith(commands: { setupCommand?: string; teardownCommand?: string; tester?: string }) {
  const { project, graphVersion } = await seedGraph(db, graph(commands.tester ?? "true"), { localClonePath: createOriginRepo() });
  await db
    .update(projects)
    .set({ setupCommand: commands.setupCommand ?? null, teardownCommand: commands.teardownCommand ?? null })
    .where(eq(projects.id, project.id));
  const run = await createRun(db, { projectId: project.id, graphVersionId: graphVersion.id, task: "Check setup" });
  const workdirs = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
  await drain(engineDeps(db, { tester: testerExecutor() }, { workdirs }));
  return { ...(await inspect(db, run.id)), worktree: workdirs.worktreePath(run.id) };
}

test("the setup command sees HANDOFF_RUN_ID, HANDOFF_RUN_SHORT and HANDOFF_WORKTREE", async () => {
  const seen = join(mkdtempSync(join(tmpdir(), "handoff-seen-")), "env");
  const { run, worktree } = await runWith({ setupCommand: `printf '%s|%s|%s' "$HANDOFF_RUN_ID" "$HANDOFF_RUN_SHORT" "$HANDOFF_WORKTREE" > ${seen}` });
  expect(run.status).toBe("succeeded");
  const [id, short, path] = readFileSync(seen, "utf8").split("|");
  expect(id).toBe(run.id);
  expect(short).toBe(run.id.slice(0, 8));
  expect(path).toBe(worktree);
});

test("the teardown command runs when the worktree is removed", async () => {
  const seen = join(mkdtempSync(join(tmpdir(), "handoff-seen-")), "teardown");
  const { run, worktree, events } = await runWith({
    setupCommand: "touch .made-by-setup",
    teardownCommand: `test -f .made-by-setup && printf '%s' "$HANDOFF_RUN_SHORT" > ${seen}`,
  });
  expect(run.status).toBe("succeeded");
  expect(readFileSync(seen, "utf8")).toBe(run.id.slice(0, 8));
  expect(existsSync(worktree)).toBe(false);
  expect(run.worktreePath).toBeNull();
  expect(events.find((e) => e.type === "teardown.finished")?.payload).toMatchObject({ exitCode: 0 });
});

test("a failing teardown command does not keep the worktree", async () => {
  const { run, worktree, events } = await runWith({ teardownCommand: "echo cannot drop >&2; exit 4" });
  expect(run.status).toBe("succeeded");
  expect(existsSync(worktree)).toBe(false);
  expect(events.find((e) => e.type === "teardown.finished")?.payload).toMatchObject({ exitCode: 4, output: expect.stringContaining("cannot drop") });
});
