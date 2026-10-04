import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { SETTING_CONFIGURATION, type LaunchConfiguration } from "@handoff/core";
import { eq, previews, registerWorker, sql, stopWorker, workers } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import { cancelRun } from "../operations.ts";
import { ensureServices, PreviewError, startPreview, stopLeftPreviews, stopPreview } from "./preview.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());
const started: number[] = [];
afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A git worktree holding `files`, as a run's would. */
function worktree(files: Record<string, string>) {
  const path = mkdtempSync(join(tmpdir(), "handoff-preview-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(path, name, ".."), { recursive: true });
    writeFileSync(join(path, name), body);
  }
  execFileSync("git", ["init", "-q"], { cwd: path });
  return { path, baseSha: "" };
}

const launch = (config: Record<string, unknown>) => JSON.stringify({ version: "0.0.1", configurations: [{ name: "web", runtimeExecutable: "node", ...config }] });
const server = `require("node:http").createServer((_, res) => res.end("hello from " + process.env.PORT)).listen(Number(process.env.PORT));`;

async function start(files: Record<string, string>, opts: { readyTimeoutMs?: number; launch?: LaunchConfiguration | null; workerId?: string } = {}) {
  const { run, project } = await seedRun(db);
  const workdir = worktree(files);
  return {
    run,
    workdir,
    preview: () => startPreview({ db, workerId: opts.workerId ?? "w1" }, { runId: run.id, projectId: project.id, workdir, readyTimeoutMs: opts.readyTimeoutMs ?? 10_000, launch: opts.launch ?? null }),
  };
}

/** The project's App launch setting, as the form saves it. */
const setting = (overrides: Partial<LaunchConfiguration> = {}): LaunchConfiguration => ({
  name: SETTING_CONFIGURATION,
  runtimeExecutable: "node",
  runtimeArgs: ["app.js"],
  args: [],
  port: 3000,
  env: {},
  ...overrides,
});

test("a run's app starts from its worktree on a free port it is told in PORT, and stops with its whole process group", async () => {
  const { preview } = await start({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"], port: 3000 }), "app.js": server });
  const row = await preview();
  started.push(row.pid!);
  expect(row).toMatchObject({ status: "running", configuration: "web", workerId: "w1", url: `http://localhost:${row.port}` });
  expect(row.port).not.toBe(3000);
  expect(await (await fetch(`http://127.0.0.1:${row.port}`)).text()).toBe(`hello from ${row.port}`);

  await stopPreview(db, row.id);
  await expect.poll(() => alive(row.pid!)).toBe(false);
  expect((await db.select().from(previews).where(eq(previews.id, row.id)))[0]).toMatchObject({ status: "stopped", stoppedAt: expect.any(Date) });
});

test("an app that never listens on PORT fails, says to read PORT, and is stopped", async () => {
  const { preview } = await start({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": "setInterval(() => {}, 1000);" });
  const error = await preview().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PreviewError);
  expect((error as Error).message).toMatch(/did not listen on port \d+.*PORT/s);
  const [row] = await db.select().from(previews);
  expect(row).toMatchObject({ status: "failed", error: expect.stringMatching(/PORT/) });
  await expect.poll(() => alive(row!.pid!)).toBe(false);
});

test("an app that exits before it is up fails with the end of its output", async () => {
  const { preview } = await start({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": `console.error("Cannot find module vite"); process.exit(1);` });
  await expect(preview()).rejects.toThrow(/exited with code 1[\s\S]*Cannot find module vite/);
});

test("an app that must have its port fails when the port is taken", async () => {
  const busy = createServer().listen(0);
  await new Promise((r) => busy.once("listening", r));
  const port = (busy.address() as { port: number }).port;
  try {
    const { preview } = await start({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"], port, autoPort: false }), "app.js": server });
    await expect(preview()).rejects.toThrow(new RegExp(`port ${port} is in use`));
  } finally {
    busy.close();
  }
});

test("a repository without a launch file or an App launch setting says how to add either", async () => {
  const { preview } = await start({ "README.md": "hi" });
  await expect(preview()).rejects.toThrow(/no \.claude\/launch\.json.*App launch/s);
});

test("a repository without a launch file starts the app as the project's App launch setting says", async () => {
  const { preview } = await start({ "web/app.js": server }, { launch: setting({ cwd: "web", url: "http://localhost:3000/shop", env: { GREETING: "hi" } }) });
  const row = await preview();
  started.push(row.pid!);
  expect(row).toMatchObject({ status: "running", configuration: SETTING_CONFIGURATION, url: `http://localhost:${row.port}/shop` });
  expect(await (await fetch(`http://127.0.0.1:${row.port}`)).text()).toBe(`hello from ${row.port}`);
});

test("the repository's launch file wins over the App launch setting", async () => {
  const { preview } = await start({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": server }, { launch: setting({ runtimeArgs: ["missing.js"] }) });
  const row = await preview();
  started.push(row.pid!);
  expect(row).toMatchObject({ status: "running", configuration: "web" });
});

test("an App launch setting whose app never listens says to turn off Any free port, not to edit a file", async () => {
  const { preview } = await start({ "app.js": "setInterval(() => {}, 1000);" }, { launch: setting(), readyTimeoutMs: 1_000 });
  const error = await preview().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PreviewError);
  expect((error as Error).message).toMatch(/turn off Any free port/);
  expect((error as Error).message).not.toMatch(/launch\.json/);
});

/** A running app that worker `workerId` started. */
async function previewOf(workerId: string) {
  const { preview } = await start({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": server }, { workerId });
  const row = await preview();
  started.push(row.pid!);
  return row;
}

const statusOf = async (id: string) => (await db.select({ status: previews.status }).from(previews).where(eq(previews.id, id)))[0]!.status;

test("a worker stops the previews it left running when it starts again", async () => {
  await registerWorker(db, { id: "w1", hostname: hostname(), caps: {} });
  const row = await previewOf("w1");
  await stopLeftPreviews(db, { workerId: "w1" });
  await expect.poll(() => alive(row.pid!)).toBe(false);
  expect(await statusOf(row.id)).toBe("stopped");
});

test("a starting worker stops the previews of workers that are no longer live, whatever their id", async () => {
  // One stopped cleanly, one crashed and stopped heartbeating; both had the default id, which changes with the pid.
  await registerWorker(db, { id: `${hostname()}:111`, hostname: hostname(), caps: {} });
  await stopWorker(db, `${hostname()}:111`);
  await registerWorker(db, { id: `${hostname()}:222`, hostname: hostname(), caps: {} });
  await db.update(workers).set({ heartbeatAt: sql`now() - interval '5 minutes'` }).where(eq(workers.id, `${hostname()}:222`));
  const stopped = await previewOf(`${hostname()}:111`);
  const crashed = await previewOf(`${hostname()}:222`);
  await registerWorker(db, { id: `${hostname()}:333`, hostname: hostname(), caps: {} });

  await stopLeftPreviews(db, { workerId: `${hostname()}:333` });

  await expect.poll(() => alive(stopped.pid!)).toBe(false);
  await expect.poll(() => alive(crashed.pid!)).toBe(false);
  expect(await statusOf(stopped.id)).toBe("stopped");
  expect(await statusOf(crashed.id)).toBe("stopped");
});

test("it leaves a live worker's previews alone", async () => {
  await registerWorker(db, { id: "live", hostname: hostname(), caps: {} });
  const row = await previewOf("live");
  await registerWorker(db, { id: "starting", hostname: hostname(), caps: {} });

  await stopLeftPreviews(db, { workerId: "starting" });

  expect(alive(row.pid!)).toBe(true);
  expect(await statusOf(row.id)).toBe("running");
  expect(await (await fetch(`http://127.0.0.1:${row.port}`)).text()).toBe(`hello from ${row.port}`);
});

test("it leaves the previews of a dead worker on another host alone: their pids are not this host's", async () => {
  await registerWorker(db, { id: "elsewhere", hostname: "another-host", caps: {} });
  await stopWorker(db, "elsewhere");
  const row = await previewOf("elsewhere");
  await registerWorker(db, { id: "starting", hostname: hostname(), caps: {} });

  await stopLeftPreviews(db, { workerId: "starting" });

  expect(alive(row.pid!)).toBe(true);
  expect(await statusOf(row.id)).toBe("running");
});

test("a repository with a compose file gets its services started once per project, kept if already up", async () => {
  const workdir = worktree({ "docker-compose.yml": "services: {}\n" });
  const calls: string[][] = [];
  await ensureServices(workdir.path, "6c588fd7-a382-4b79-b10b-695212d490e2", async (args) => {
    calls.push(args);
    return { exitCode: 0, output: "" };
  });
  expect(calls).toEqual([
    ["info"],
    ["compose", "-p", "handoff-6c588fd7", "-f", "docker-compose.yml", "up", "-d", "--wait", "--no-recreate"],
  ]);
});

test("services that need Docker fail plainly when Docker is not running", async () => {
  const workdir = worktree({ "compose.yaml": "services: {}\n" });
  await expect(ensureServices(workdir.path, "p1", async () => ({ exitCode: 1, output: "Cannot connect to the Docker daemon" }))).rejects.toThrow(/Docker is not running/);
  // Without a compose file there is nothing to start.
  const plain = worktree({ "README.md": "" });
  await expect(ensureServices(plain.path, "p1", async () => ({ exitCode: 1, output: "" }))).resolves.toBeUndefined();
});

test("cancelling a run stops its app", async () => {
  const { preview, run } = await start({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": server });
  const row = await preview();
  started.push(row.pid!);
  await cancelRun(db, run.id);
  await expect.poll(() => alive(row.pid!)).toBe(false);
  expect((await db.select().from(previews))[0]!.status).toBe("stopped");
});

test("services whose ports another stack already holds are taken as running, and the app goes on", async () => {
  const workdir = worktree({ "docker-compose.yml": "services: {}\n" });
  const notes: string[] = [];
  await expect(
    ensureServices(
      workdir.path,
      "p1",
      async (args) => (args[0] === "info" ? { exitCode: 0, output: "" } : { exitCode: 1, output: "Error response from daemon: Bind for 127.0.0.1:5434 failed: port is already allocated" }),
      (note) => notes.push(note),
    ),
  ).resolves.toBeUndefined();
  expect(notes).toEqual([expect.stringMatching(/already in use.*another Docker stack/s)]);
  // Any other failure still stops the preview.
  await expect(ensureServices(workdir.path, "p1", async (args) => (args[0] === "info" ? { exitCode: 0, output: "" } : { exitCode: 1, output: "no such image" }))).rejects.toThrow(/did not start/);
});
