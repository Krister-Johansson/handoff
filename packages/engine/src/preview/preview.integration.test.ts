import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeEach, describe, expect, onTestFinished, test } from "vitest";
import { SETTING_CONFIGURATION, type LaunchConfiguration } from "@handoff/core";
import { eq, previews, registerWorker, sql, stopWorker, workers } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import { cancelRun } from "../operations.ts";
import { createOriginRepo } from "../testing/git.ts";
import { DockerWorkdirProvider } from "../workdir/docker.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { ensureServices, PreviewError, startPreview, stopLeftPreviews, stopPreview, type DockerExec } from "./preview.ts";

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

test("a starting worker removes only the preview containers whose row has ended and names them", async () => {
  const { run } = await seedRun(db);
  const row = (id: string, status: "running" | "stopped" | "failed", container: string) => ({ id, runId: run.id, configuration: "web", workerId: "w1", status, port: 1, url: "http://localhost:1", logPath: "/tmp/log", container });
  const [stopped, failed, live, renamed, unknown] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await db.insert(previews).values([
    row(stopped, "stopped", "handoff-preview-a"),
    row(failed, "failed", "handoff-preview-b"),
    row(live, "running", "handoff-preview-c"),
    row(renamed, "stopped", "handoff-preview-d"),
  ]);
  const listing = [`handoff-preview-a\t${stopped}`, `handoff-preview-b\t${failed}`, `handoff-preview-c\t${live}`, `someone-elses\t${renamed}`, `handoff-preview-e\t${unknown}`, "handoff-preview-f\tnot-an-id"].join("\n");
  const removed: string[] = [];
  const fake: DockerExec = async (args) => {
    if (args[0] === "ps") return { exitCode: 0, output: `${listing}\n` };
    if (args[0] === "rm") removed.push(args.at(-1)!);
    return { exitCode: 0, output: "" };
  };

  await stopLeftPreviews(db, { workerId: "starting", docker: fake });

  expect(removed.sort()).toEqual(["handoff-preview-a", "handoff-preview-b"]);
  // Without Docker there is nothing to remove, and the worker starts as before.
  await expect(stopLeftPreviews(db, { workerId: "starting", docker: async () => ({ exitCode: 1, output: "Cannot connect to the Docker daemon" }) })).resolves.toBeUndefined();
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

const dockerEnabled = process.env.HANDOFF_TEST_DOCKER === "1";
const image = process.env.HANDOFF_TEST_DOCKER_IMAGE ?? "node:22-alpine";
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const appContainersOf = (runId: string) =>
  docker("ps", "-a", "--filter", `label=handoff.run=${runId}`, "--filter", "label=handoff.preview", "--format", "{{.Names}}").split("\n").filter(Boolean);
const execFileAsync = promisify(execFile);

/** The real docker client, as a DockerExec. */
const realDocker: DockerExec = async (args, cwd) => {
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, { cwd });
    return { exitCode: 0, output: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string; message: string };
    return { exitCode: typeof e.code === "number" ? e.code : 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` || e.message };
  }
};

/** An app that answers with its port and the container it runs in, listening where HOST says. */
const dockerServer = `require("node:http").createServer((_, res) => res.end("hello from " + process.env.PORT + " in " + require("node:os").hostname())).listen(Number(process.env.PORT), process.env.HOST);`;

/**
 * A run in a Docker workspace: its worktree holds `files`, and its container comes from
 * DockerWorkdirProvider with HANDOFF_HOME as the only mount, as the worker makes it. The run's
 * container and every app container of the run are removed when the test ends.
 */
async function dockerStart(files: Record<string, string>, opts: { readyTimeoutMs?: number; seedCommand?: string; docker?: DockerExec; workerId?: string } = {}) {
  const { run, project } = await seedRun(db);
  const home = mkdtempSync(join(tmpdir(), "handoff-docker-home-"));
  const provider = new DockerWorkdirProvider({ git: new GitWorktreeProvider({ root: home }), image, mounts: [home] });
  const spec = { runId: run.id, remoteUrl: createOriginRepo(files), baseBranch: "main", branchName: "handoff/preview" };
  const workdir = await provider.acquire(spec);
  onTestFinished(async () => {
    for (const name of appContainersOf(run.id)) execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
    await provider.release(spec);
  });
  return {
    run,
    workdir,
    preview: () =>
      startPreview(
        { db, workerId: opts.workerId ?? "w1" },
        { runId: run.id, projectId: project.id, workdir, readyTimeoutMs: opts.readyTimeoutMs ?? 15_000, seedCommand: opts.seedCommand ?? null, ...(opts.docker ? { docker: opts.docker } : {}) },
      ),
  };
}

const containerHostname = (name: string) => docker("inspect", "-f", "{{.Config.Hostname}}", name);

describe.skipIf(!dockerEnabled)("in a Docker workspace", () => {
  test("a run's app starts in a container next to the run's on a free port and answers at localhost from the host", async () => {
    const { run, workdir, preview } = await dockerStart({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"], port: 3000 }), "app.js": dockerServer });
    const row = await preview();
    expect(row).toMatchObject({ status: "running", container: `handoff-preview-${row.id.slice(0, 8)}`, url: `http://localhost:${row.port}` });
    expect(row.port).not.toBe(3000);
    expect(row.container).not.toBe(workdir.container);
    expect(await (await fetch(row.url)).text()).toBe(`hello from ${row.port} in ${containerHostname(row.container!)}`);
    expect(JSON.parse(docker("inspect", "-f", "{{json .Config.Labels}}", row.container!))).toMatchObject({ "handoff.preview": row.id, "handoff.run": run.id, "handoff.worker": "w1" });
  });

  test("an app that listens only on 127.0.0.1 inside its container fails and says to listen on 0.0.0.0", async () => {
    const loopback = `require("node:http").createServer((_, res) => res.end("hi")).listen(Number(process.env.PORT), "127.0.0.1");`;
    const { run, preview } = await dockerStart({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": loopback }, { readyTimeoutMs: 3_000 });
    const error = await preview().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreviewError);
    expect((error as Error).message).toMatch(/listens on port \d+ only on 127\.0\.0\.1 inside its container.*0\.0\.0\.0/s);
    expect((await db.select().from(previews))[0]).toMatchObject({ status: "failed", container: expect.stringMatching(/^handoff-preview-/) });
    expect(appContainersOf(run.id)).toEqual([]);
  });

  test("an app that never listens fails and says to read PORT", async () => {
    const { run, preview } = await dockerStart({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": "setInterval(() => {}, 1000);" }, { readyTimeoutMs: 3_000 });
    const error = await preview().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreviewError);
    expect((error as Error).message).toMatch(/did not listen on port \d+.*PORT/s);
    expect(appContainersOf(run.id)).toEqual([]);
  });

  test("an app that exits before it is up fails with the end of its output", async () => {
    const { run, preview } = await dockerStart({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": `console.error("Cannot find module vite"); process.exit(1);` });
    await expect(preview()).rejects.toThrow(/exited with code 1[\s\S]*Cannot find module vite/);
    expect(appContainersOf(run.id)).toEqual([]);
  });

  test("the seed command runs in the app's container", async () => {
    const { workdir, preview } = await dockerStart({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": dockerServer }, { seedCommand: "hostname > seeded-in" });
    const row = await preview();
    expect(readFileSync(join(workdir.path, "seeded-in"), "utf8").trim()).toBe(containerHostname(row.container!));
  });

  test("an app that must have its port fails when the port is taken", async () => {
    const busy = createServer().listen(0);
    await new Promise((r) => busy.once("listening", r));
    onTestFinished(() => void busy.close());
    const port = (busy.address() as { port: number }).port;
    const { run, preview } = await dockerStart({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"], port, autoPort: false }), "app.js": dockerServer });
    await expect(preview()).rejects.toThrow(new RegExp(`port ${port} is in use`));
    expect(appContainersOf(run.id)).toEqual([]);
  });

  test("the app reaches the compose file's services at localhost on their ports", async () => {
    // A service on the host, listening on all addresses as compose publishes "5432:5432".
    const service = createHttpServer((_, res) => res.end("from the service"));
    await new Promise<void>((resolve) => service.listen(0, "0.0.0.0", resolve));
    onTestFinished(() => new Promise<void>((resolve) => service.close(() => resolve())));
    const servicePort = (service.address() as { port: number }).port;
    // Compose itself is faked: starting a stack would make a network.
    const composeConfig = JSON.stringify({ services: { db: { ports: [{ target: 80, published: String(servicePort), protocol: "tcp" }] } } });
    const fake: DockerExec = (args, cwd) => (args[0] === "compose" ? Promise.resolve({ exitCode: 0, output: args.includes("config") ? composeConfig : "" }) : realDocker(args, cwd));
    const app = `require("node:http").createServer(async (_, res) => res.end(await (await fetch("http://localhost:${servicePort}/")).text())).listen(Number(process.env.PORT), process.env.HOST);`;
    const { preview } = await dockerStart({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": app, "compose.yaml": "services: {}\n" }, { docker: fake });
    const row = await preview();
    expect(await (await fetch(row.url)).text()).toBe("from the service");
  });

  test("stopPreview removes the app's container", async () => {
    const { run, preview } = await dockerStart({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": dockerServer });
    const row = await preview();
    await stopPreview(db, row.id);
    expect(appContainersOf(run.id)).toEqual([]);
    expect(await statusOf(row.id)).toBe("stopped");
    await expect(fetch(row.url, { signal: AbortSignal.timeout(2_000) })).rejects.toThrow();
  });

  const appFiles = { ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": dockerServer };
  const running = (name: string) => docker("inspect", "-f", "{{.State.Running}}", name) === "true";

  test("a preview container whose row is not running is removed when a worker starts", async () => {
    await registerWorker(db, { id: "live", hostname: hostname(), caps: {} });
    const { run, preview } = await dockerStart(appFiles, { workerId: "live" });
    const row = await preview();
    // The row ended but the container stayed, as when Docker was not running while the app was stopped.
    await db.update(previews).set({ status: "stopped", stoppedAt: new Date() }).where(eq(previews.id, row.id));
    await registerWorker(db, { id: "starting", hostname: hostname(), caps: {} });

    await stopLeftPreviews(db, { workerId: "starting" });

    expect(appContainersOf(run.id)).toEqual([]);
  });

  test("a starting worker removes the containers of the previews a worker that is no longer live left", async () => {
    await registerWorker(db, { id: `${hostname()}:111`, hostname: hostname(), caps: {} });
    await stopWorker(db, `${hostname()}:111`);
    const { run, preview } = await dockerStart(appFiles, { workerId: `${hostname()}:111` });
    const row = await preview();
    await registerWorker(db, { id: `${hostname()}:222`, hostname: hostname(), caps: {} });

    await stopLeftPreviews(db, { workerId: `${hostname()}:222` });

    expect(appContainersOf(run.id)).toEqual([]);
    expect(await statusOf(row.id)).toBe("stopped");
  });

  test("it leaves a live worker's preview container alone, and every container whose preview this database does not hold", async () => {
    await registerWorker(db, { id: "live", hostname: hostname(), caps: {} });
    const { preview } = await dockerStart(appFiles, { workerId: "live" });
    const row = await preview();
    // Preview containers of another database, such as the person's own worker's while these tests run, and one with a label that is not an id.
    const others = [randomUUID(), "not-an-id"].map((id) => {
      const name = `handoff-test-other-${randomUUID().slice(0, 8)}`;
      docker("run", "-d", "--name", name, "--label", `handoff.preview=${id}`, "--label", `handoff.run=${randomUUID()}`, image, "sleep", "infinity");
      onTestFinished(() => void execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }));
      return name;
    });
    await registerWorker(db, { id: "starting", hostname: hostname(), caps: {} });

    await stopLeftPreviews(db, { workerId: "starting" });

    expect(await statusOf(row.id)).toBe("running");
    expect(running(row.container!)).toBe(true);
    expect(await (await fetch(row.url)).text()).toMatch(`hello from ${row.port}`);
    for (const name of others) expect(running(name)).toBe(true);
  });

  test("cancelling a run removes its app's container", async () => {
    const { run, preview } = await dockerStart({ ".claude/launch.json": launch({ runtimeArgs: ["app.js"] }), "app.js": dockerServer });
    const row = await preview();
    await cancelRun(db, run.id);
    expect(appContainersOf(run.id)).toEqual([]);
    expect(await statusOf(row.id)).toBe("stopped");
  });
});
