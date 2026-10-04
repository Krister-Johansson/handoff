import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, onTestFinished, test } from "vitest";
import { SETTING_CONFIGURATION, type LaunchConfiguration } from "@handoff/core";
import { eq, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { createOriginRepo } from "../testing/git.ts";
import { DockerWorkdirProvider } from "../workdir/docker.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { launchTestOf, startLaunchTest, stopLaunchTest, type StartLaunchTestOptions } from "./launch-test.ts";

const db = createTestDb();
const pids: number[] = [];
beforeEach(() => truncateAll(db));
afterEach(() => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
});
afterAll(() => db.$client.end());

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const server = `require("node:http").createServer((_, res) => res.end("hello from " + process.env.PORT)).listen(Number(process.env.PORT));`;

/** The App launch form's configuration, as the project settings page passes it. */
const form = (overrides: Partial<LaunchConfiguration> = {}): LaunchConfiguration => ({
  name: SETTING_CONFIGURATION,
  runtimeExecutable: "node",
  runtimeArgs: ["app.js"],
  args: [],
  port: 3000,
  env: {},
  ...overrides,
});

/** A project whose repository holds `files` on main, and the dependencies a Test start needs. */
async function project(files: Record<string, string>, values: Partial<typeof projects.$inferInsert> = {}) {
  const origin = createOriginRepo(files);
  const [row] = await db
    .insert(projects)
    .values({ name: `p-${crypto.randomUUID()}`, repoOwner: "o", repoName: "r", defaultBranch: "main", localClonePath: origin, ...values })
    .returning();
  const deps = { db, workdirs: new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")), retryMs: 10 }) };
  return { project: row!, deps, origin };
}

const headOf = (origin: string) => execFileSync("git", ["rev-parse", "--short", "main"], { cwd: origin }).toString().trim();

test("Test start runs the form's app from a fresh worktree of the default branch, step by step, until it is stopped", async () => {
  const { project: p, deps, origin } = await project({ "app.js": server }, { setupCommand: "touch installed", demoSeedCommand: "test -f installed" });
  const { test: started, finished } = await startLaunchTest(deps, { projectId: p.id, launch: form(), readyTimeoutMs: 10_000 });
  expect(started).toMatchObject({ status: "starting", command: "node app.js" });

  const ready = await finished;
  pids.push(ready.pid!);
  expect(ready).toMatchObject({ status: "ready", url: `http://localhost:${ready.port}`, readyAt: expect.any(Date) });
  expect(ready.stopsAt.getTime() - ready.createdAt.getTime()).toBe(10 * 60_000);
  expect(ready.steps).toEqual([
    { name: "worktree", status: "done", detail: `A fresh worktree of main at ${headOf(origin)}`, ms: expect.any(Number) },
    { name: "setup", status: "done", detail: "`touch installed` exited 0", ms: expect.any(Number) },
    { name: "services", status: "done", detail: "None in the repository", ms: expect.any(Number) },
    { name: "seed", status: "done", detail: "`test -f installed` exited 0", ms: expect.any(Number) },
    { name: "app", status: "done", detail: `Listening on port ${ready.port}`, ms: expect.any(Number) },
  ]);
  expect(await (await fetch(`http://127.0.0.1:${ready.port}`)).text()).toBe(`hello from ${ready.port}`);
  expect(existsSync(ready.worktreePath!)).toBe(true);

  await stopLaunchTest(deps, ready.id);
  await expect.poll(() => alive(ready.pid!)).toBe(false);
  expect(existsSync(ready.worktreePath!)).toBe(false);
  expect(await launchTestOf(deps, p.id)).toMatchObject({ test: { status: "stopped", stoppedAt: expect.any(Date) } });
});

test("an app that does not start fails with why and the end of its output, and leaves no worktree behind", async () => {
  const { project: p, deps } = await project({ "app.js": `console.error("Cannot find module vite"); process.exit(1);` });
  const { finished } = await startLaunchTest(deps, { projectId: p.id, launch: form(), readyTimeoutMs: 10_000 });
  const failed = await finished;
  expect(failed).toMatchObject({ status: "failed", error: "The app exited with code 1 before it was up:", log: expect.stringContaining("Cannot find module vite") });
  expect(failed.steps.at(-1)).toMatchObject({ name: "app", status: "failed", detail: "Exited with code 1" });
  expect(existsSync(failed.worktreePath!)).toBe(false);
});

test("a setup command that fails stops the Test start there, with its output", async () => {
  const { project: p, deps } = await project({ "app.js": server }, { setupCommand: "echo no lockfile; exit 3" });
  const failed = await (await startLaunchTest(deps, { projectId: p.id, launch: form() })).finished;
  expect(failed).toMatchObject({ status: "failed", error: expect.stringMatching(/setup command `echo no lockfile; exit 3` exited 3/), log: expect.stringContaining("no lockfile") });
  expect(failed.steps.map((s) => [s.name, s.status])).toEqual([
    ["worktree", "done"],
    ["setup", "failed"],
  ]);
});

test("a repository handoff cannot check out fails at the worktree, with git's own words as the log", async () => {
  const { project: p, deps } = await project({ "app.js": server });
  await db.update(projects).set({ localClonePath: join(tmpdir(), "handoff-no-such-repo") }).where(eq(projects.id, p.id));
  const failed = await (await startLaunchTest(deps, { projectId: p.id, launch: form() })).finished;
  expect(failed).toMatchObject({ status: "failed", error: "Handoff could not make a fresh worktree of main.", log: expect.stringContaining("handoff-no-such-repo") });
  expect(failed.steps).toEqual([{ name: "worktree", status: "failed", detail: "Could not check out main", ms: expect.any(Number) }]);
});

test("the repository's launch file wins over the form", async () => {
  const file = JSON.stringify({ configurations: [{ name: "web", runtimeExecutable: "node", runtimeArgs: ["app.js", "--from-file"] }] });
  const { project: p, deps } = await project({ ".claude/launch.json": file, "app.js": server });
  const ready = await (await startLaunchTest(deps, { projectId: p.id, launch: form({ runtimeArgs: ["missing.js"] }), readyTimeoutMs: 10_000 })).finished;
  pids.push(ready.pid!);
  expect(ready).toMatchObject({ status: "ready", command: "node app.js --from-file" });
  await stopLaunchTest(deps, ready.id);
});

test("a Test start stops by itself when its time is up, and a new one stops the one before", async () => {
  const { project: p, deps } = await project({ "app.js": server });
  const first = await (await startLaunchTest(deps, { projectId: p.id, launch: form(), readyTimeoutMs: 10_000 })).finished;
  pids.push(first.pid!);
  const second = await (await startLaunchTest(deps, { projectId: p.id, launch: form(), readyTimeoutMs: 10_000, lifetimeMs: 1_000 })).finished;
  pids.push(second.pid!);
  await expect.poll(() => alive(first.pid!)).toBe(false);
  expect(second.status).toBe("ready");

  await expect.poll(() => alive(second.pid!), { timeout: 10_000 }).toBe(false);
  await expect.poll(async () => (await launchTestOf(deps, p.id))?.test.status, { timeout: 10_000 }).toBe("stopped");
});

test("reading a Test start past its time stops it, as after the dashboard restarted", async () => {
  const { project: p, deps } = await project({ "app.js": server });
  const ready = await (await startLaunchTest(deps, { projectId: p.id, launch: form(), readyTimeoutMs: 10_000, lifetimeMs: 60_000, timer: false })).finished;
  pids.push(ready.pid!);
  const now = new Date(ready.stopsAt.getTime() + 1);
  expect(await launchTestOf(deps, p.id, now)).toMatchObject({ test: { status: "stopped" } });
  await expect.poll(() => alive(ready.pid!)).toBe(false);
});

test("a ready Test start shows the end of the app's log", async () => {
  const { project: p, deps } = await project({ "app.js": `console.log("compiled in 2.1s"); ${server}` });
  const ready = await (await startLaunchTest(deps, { projectId: p.id, launch: form(), readyTimeoutMs: 10_000 })).finished;
  pids.push(ready.pid!);
  await expect.poll(async () => (await launchTestOf(deps, p.id))?.log).toContain("compiled in 2.1s");
  await stopLaunchTest(deps, ready.id);
});

const dockerEnabled = process.env.HANDOFF_TEST_DOCKER === "1";
const image = process.env.HANDOFF_TEST_DOCKER_IMAGE ?? "node:22-alpine";
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
/** Every container of a Test start, by the run label its setup container and its app's container both carry. */
const containersOf = (testId: string) =>
  docker("ps", "-a", "--filter", `label=handoff.run=${testId}`, "--format", "{{.Names}}").split("\n").filter(Boolean).sort();
const containerHostname = (name: string) => docker("inspect", "-f", "{{.Config.Hostname}}", name);

/** An app that answers with its port and the container it runs in, listening where HOST says. */
const dockerServer = `require("node:http").createServer((_, res) => res.end("hello from " + process.env.PORT + " in " + require("node:os").hostname())).listen(Number(process.env.PORT), process.env.HOST);`;

/**
 * A project in a Docker workspace: its Test starts make their worktrees under a fresh HANDOFF_HOME with
 * DockerWorkdirProvider, HANDOFF_HOME the only mount, as the dashboard makes it. Every Test start it
 * began is stopped, and its containers removed, when the test ends.
 */
async function dockerProject(files: Record<string, string>, values: (home: string) => Partial<typeof projects.$inferInsert> = () => ({})) {
  const home = mkdtempSync(join(tmpdir(), "handoff-docker-home-"));
  const origin = createOriginRepo(files);
  const [row] = await db
    .insert(projects)
    .values({ name: `p-${crypto.randomUUID()}`, repoOwner: "o", repoName: "r", defaultBranch: "main", localClonePath: origin, ...values(home) })
    .returning();
  const deps = { db, workdirs: new DockerWorkdirProvider({ git: new GitWorktreeProvider({ root: home, retryMs: 10 }), image, mounts: [home] }) };
  const ids: string[] = [];
  onTestFinished(async () => {
    for (const id of ids) {
      await stopLaunchTest(deps, id);
      for (const name of containersOf(id)) execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
    }
  });
  const start = async (opts: Partial<StartLaunchTestOptions> = {}) => {
    const { test: started, finished } = await startLaunchTest(deps, { projectId: row!.id, launch: form(), readyTimeoutMs: 15_000, timer: false, ...opts });
    ids.push(started.id);
    return finished;
  };
  return { project: row!, home, deps, start };
}

describe.skipIf(!dockerEnabled)("in a Docker workspace", () => {
  test("Test start in a Docker workspace runs setup in a container and the app in its sibling, at localhost", async () => {
    const { deps, start } = await dockerProject({ "app.js": dockerServer }, () => ({ setupCommand: "hostname > setup-in" }));
    const ready = await start();
    const setup = `handoff-${ready.id}`;
    const app = `handoff-preview-${ready.id.slice(0, 8)}`;
    expect(ready).toMatchObject({ status: "ready", container: app, url: `http://localhost:${ready.port}` });
    expect(containersOf(ready.id)).toEqual([setup, app].sort());
    expect(ready.steps).toEqual([
      expect.objectContaining({ name: "worktree", status: "done" }),
      { name: "setup", status: "done", detail: `\`hostname > setup-in\` exited 0 in container ${setup}`, ms: expect.any(Number) },
      expect.objectContaining({ name: "services", status: "done" }),
      expect.objectContaining({ name: "seed", status: "done" }),
      { name: "app", status: "done", detail: `Listening on port ${ready.port} in container ${app}`, ms: expect.any(Number) },
    ]);
    expect(readFileSync(join(ready.worktreePath!, "setup-in"), "utf8").trim()).toBe(containerHostname(setup));
    expect(await (await fetch(ready.url!)).text()).toBe(`hello from ${ready.port} in ${containerHostname(app)}`);
    // A worker's cleanup removes containers labelled handoff.preview whose preview row is not running; a Test start has no such row.
    const labels = JSON.parse(docker("inspect", "-f", "{{json .Config.Labels}}", app)) as Record<string, string>;
    expect(labels).toMatchObject({ "handoff.launch-test": ready.id, "handoff.run": ready.id });
    expect(labels).not.toHaveProperty("handoff.preview");

    await stopLaunchTest(deps, ready.id);
    expect(containersOf(ready.id)).toEqual([]);
    expect(existsSync(ready.worktreePath!)).toBe(false);
  });

  test("a Test start past its 10 minutes removes both containers and the worktree", async () => {
    const { project: p, home, deps, start } = await dockerProject({ "app.js": dockerServer }, (home) => ({ teardownCommand: `hostname > ${home}/torn-down-in` }));
    const ready = await start();
    expect(ready.stopsAt.getTime() - ready.createdAt.getTime()).toBe(10 * 60_000);
    const setupHostname = containerHostname(`handoff-${ready.id}`);

    expect(await launchTestOf(deps, p.id, new Date(ready.stopsAt.getTime() + 1))).toMatchObject({ test: { status: "stopped" } });
    expect(containersOf(ready.id)).toEqual([]);
    expect(existsSync(ready.worktreePath!)).toBe(false);
    // The teardown command runs where the setup command ran, in the setup container.
    expect(readFileSync(join(home, "torn-down-in"), "utf8").trim()).toBe(setupHostname);
    await expect(fetch(ready.url!, { signal: AbortSignal.timeout(2_000) })).rejects.toThrow();
  });

  test("a new Test start removes the previous one's containers", async () => {
    const { start } = await dockerProject({ "app.js": dockerServer });
    const first = await start();
    expect(containersOf(first.id)).toHaveLength(2);
    const second = await start();
    expect(second.status).toBe("ready");
    expect(containersOf(first.id)).toEqual([]);
    expect(existsSync(first.worktreePath!)).toBe(false);
    expect(containersOf(second.id)).toEqual([`handoff-${second.id}`, `handoff-preview-${second.id.slice(0, 8)}`].sort());
    expect(await (await fetch(second.url!)).text()).toBe(`hello from ${second.port} in ${containerHostname(second.container!)}`);
  });
});
