import { commandLine, type LaunchConfiguration } from "@handoff/core";
import { and, desc, eq, inArray, launchTests, projects, type Db, type LaunchTestStep, type LaunchTestStepName } from "@handoff/db";
import { shell } from "../contract/checks.ts";
import { defaultRemote } from "../scheduler/worker.ts";
import type { WorkdirProvider, WorkdirSpec } from "../types.ts";
import { runIdentity, SetupFailedError, setUpWorkdir } from "../workdir/setup.ts";
import { launchApp, launchConfigurationFor, logTail, PreviewError, stopGroup, type DockerExec } from "./preview.ts";

// The dashboard makes a Test start's worktree with the same provider the worker uses.
export { GitWorktreeProvider } from "../workdir/git-worktree.ts";

/** How long a Test start keeps the app running before it stops it. */
export const LAUNCH_TEST_LIFETIME_MS = 10 * 60_000;
const TEARDOWN_TIMEOUT_MS = 10 * 60_000;

export type LaunchTestRow = typeof launchTests.$inferSelect;

export type LaunchTestDeps = {
  db: Db;
  /** Makes the fresh worktree of the default branch; git worktrees, never containers. */
  workdirs: WorkdirProvider;
  docker?: DockerExec;
};

/** What each Test start in this process can be stopped with while it is still starting. */
const starting = new Map<string, AbortController>();

const specOf = (project: typeof projects.$inferSelect, id: string): WorkdirSpec => ({
  runId: id,
  remoteUrl: defaultRemote(project),
  baseBranch: project.defaultBranch,
  branchName: `handoff/launch-test-${id.slice(0, 8)}`,
  detached: true,
});

/** A failure's sentence, and the output it quotes. */
function explain(error: unknown): { error: string; log: string | null } {
  if (error instanceof PreviewError) return { error: error.summary, log: error.log ?? null };
  if (error instanceof SetupFailedError) {
    const [first, ...rest] = error.message.split("\n");
    return { error: first!, log: rest.join("\n").trimEnd().split("\n").slice(-20).join("\n") || null };
  }
  return { error: (error as Error).message, log: null };
}

export type StartLaunchTestOptions = {
  projectId: string;
  /** The App launch form's values, saved or not. The repository's launch file wins over them. */
  launch: LaunchConfiguration | null;
  readyTimeoutMs?: number;
  lifetimeMs?: number;
  /** false: no timer stops it in this process; reading it past its time does. */
  timer?: boolean;
};

/**
 * Test start: starts the project's app as Try it and demo steps would, from a fresh worktree of the
 * default branch outside any run, with the form's values when the repository has no launch file. It
 * stops any Test start of the project still running first. Returns the new row at once; `finished`
 * settles with the row once the app is ready or has failed. The app stops after `lifetimeMs`.
 */
export async function startLaunchTest(deps: LaunchTestDeps, opts: StartLaunchTestOptions): Promise<{ test: LaunchTestRow; finished: Promise<LaunchTestRow> }> {
  const { db } = deps;
  const [project] = await db.select().from(projects).where(eq(projects.id, opts.projectId));
  if (!project) throw new Error("The project no longer exists.");
  const running = await db.select({ id: launchTests.id }).from(launchTests).where(and(eq(launchTests.projectId, project.id), inArray(launchTests.status, ["starting", "ready"])));
  await Promise.all(running.map((r) => stopLaunchTest(deps, r.id)));

  const lifetimeMs = opts.lifetimeMs ?? LAUNCH_TEST_LIFETIME_MS;
  const now = new Date();
  const [test] = await db
    .insert(launchTests)
    .values({ projectId: project.id, command: opts.launch ? commandLine(opts.launch) : "", createdAt: now, stopsAt: new Date(now.getTime() + lifetimeMs) })
    .returning();
  const id = test!.id;
  const controller = new AbortController();
  starting.set(id, controller);
  if (opts.timer !== false) setTimeout(() => void stopLaunchTest(deps, id).catch(() => {}), lifetimeMs).unref();

  const steps: LaunchTestStep[] = [];
  const begun = new Map<LaunchTestStepName, number>();
  let saving: Promise<unknown> = Promise.resolve();
  const save = (values: Partial<typeof launchTests.$inferInsert>) =>
    (saving = saving.then(() => db.update(launchTests).set(values).where(and(eq(launchTests.id, id), eq(launchTests.status, "starting")))));
  const step = (name: LaunchTestStepName, status: LaunchTestStep["status"], detail: string) => {
    if (status === "running") begun.set(name, Date.now());
    const ms = status === "running" ? null : Date.now() - (begun.get(name) ?? Date.now());
    const entry = { name, status, detail, ms };
    const at = steps.findIndex((s) => s.name === name);
    if (at === -1) steps.push(entry);
    else steps[at] = entry;
    save({ steps: [...steps] });
  };

  const spec = specOf(project, id);
  const finished = (async (): Promise<LaunchTestRow> => {
    let logPath: string | undefined;
    try {
      step("worktree", "running", `Making a fresh worktree of ${project.defaultBranch}`);
      let workdir;
      try {
        workdir = await deps.workdirs.acquire(spec);
      } catch (error) {
        step("worktree", "failed", `Could not check out ${project.defaultBranch}`);
        throw error;
      }
      step("worktree", "done", `A fresh worktree of ${project.defaultBranch} at ${workdir.baseSha.slice(0, 7)}`);
      save({ worktreePath: workdir.path });
      const identity = runIdentity(id, workdir.path);

      if (project.setupCommand) {
        step("setup", "running", `\`${project.setupCommand}\``);
        try {
          await setUpWorkdir(workdir, project.setupCommand, () => {}, controller.signal, identity);
        } catch (error) {
          step("setup", "failed", `\`${project.setupCommand}\` failed`);
          throw error;
        }
        step("setup", "done", `\`${project.setupCommand}\` exited 0`);
      }

      const { config, source } = launchConfigurationFor(workdir.path, { launch: opts.launch });
      save({ command: commandLine(config) });
      await launchApp({
        root: workdir.path,
        projectId: project.id,
        config,
        source,
        identity,
        seedCommand: project.demoSeedCommand,
        signal: controller.signal,
        ...(opts.readyTimeoutMs !== undefined ? { readyTimeoutMs: opts.readyTimeoutMs } : {}),
        ...(deps.docker ? { docker: deps.docker } : {}),
        onStep: (e) => step(e.step, e.status, e.detail),
        onSpawn: async (app) => {
          logPath = app.logPath;
          save({ pid: app.pid ?? null, port: app.port, url: app.url, logPath: app.logPath });
        },
      });
      save({ status: "ready", readyAt: new Date() });
    } catch (error) {
      // The log lives in the worktree's git directory, which goes with the worktree.
      const why = explain(error);
      save({ status: "failed", error: why.error, log: why.log ?? (logPath ? logTail(logPath) || null : null), stoppedAt: new Date() });
      await saving;
      await release(deps, project, id);
    } finally {
      starting.delete(id);
    }
    await saving;
    const [row] = await db.select().from(launchTests).where(eq(launchTests.id, id));
    return row!;
  })();
  return { test: test!, finished };
}

/** Runs the project's teardown command in a Test start's worktree, then removes the worktree. Never throws. */
async function release(deps: LaunchTestDeps, project: typeof projects.$inferSelect, id: string) {
  const [row] = await deps.db.select({ worktreePath: launchTests.worktreePath }).from(launchTests).where(eq(launchTests.id, id));
  const spec = specOf(project, id);
  try {
    if (project.teardownCommand && row?.worktreePath) {
      await shell(project.teardownCommand, row.worktreePath, TEARDOWN_TIMEOUT_MS, undefined, [], undefined, runIdentity(id, row.worktreePath)).catch(() => undefined);
    }
    await deps.workdirs.release(spec);
  } catch {
    // A worktree left behind is removed with the clone's next prune; the app is already stopped.
  }
}

/**
 * Stops a Test start: its app's process group, then its worktree. Stopping one that already ended does
 * nothing.
 */
export async function stopLaunchTest(deps: LaunchTestDeps, id: string): Promise<void> {
  const [row] = await deps.db
    .update(launchTests)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(and(eq(launchTests.id, id), inArray(launchTests.status, ["starting", "ready"])))
    .returning();
  if (!row) return;
  starting.get(id)?.abort();
  if (row.pid) await stopGroup(row.pid);
  const [project] = await deps.db.select().from(projects).where(eq(projects.id, row.projectId));
  if (project) await release(deps, project, id);
}

/**
 * A project's latest Test start and the end of its app's log while it runs; undefined when it has none.
 * One past its time is stopped first, so a Test start a restarted dashboard lost track of still ends.
 */
export async function launchTestOf(deps: LaunchTestDeps, projectId: string, now = new Date()): Promise<{ test: LaunchTestRow; log: string } | undefined> {
  const latest = async () => (await deps.db.select().from(launchTests).where(eq(launchTests.projectId, projectId)).orderBy(desc(launchTests.createdAt)).limit(1))[0];
  let test = await latest();
  if (!test) return undefined;
  if ((test.status === "starting" || test.status === "ready") && test.stopsAt <= now) {
    await stopLaunchTest(deps, test.id);
    test = (await latest())!;
  }
  const log = test.status === "ready" && test.logPath ? logTail(test.logPath, 40) : (test.log ?? "");
  return { test, log };
}
