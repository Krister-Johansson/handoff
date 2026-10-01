import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { LAUNCH_FILE, parseLaunchFile, previewCommand } from "@handoff/core";
import { and, eq, inArray, previews, type Db } from "@handoff/db";
import { commandEnv } from "../contract/checks.ts";
import type { Workdir } from "../types.ts";

const execFileAsync = promisify(execFile);
const READY_TIMEOUT_MS = 120_000;
const STOP_GRACE_MS = 5_000;
const SERVICES_TIMEOUT_MS = 5 * 60_000;
const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

/** A run's app could not start; the message says why in terms a person can act on. */
export class PreviewError extends Error {}

export type PreviewRow = typeof previews.$inferSelect;

/** Runs `docker` with `args` in `cwd`. Tests replace it. */
export type DockerExec = (args: string[], cwd: string) => Promise<{ exitCode: number; output: string }>;

const docker: DockerExec = async (args, cwd) => {
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, { cwd, timeout: SERVICES_TIMEOUT_MS });
    return { exitCode: 0, output: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string; message: string };
    return { exitCode: typeof e.code === "number" ? e.code : 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` || e.message };
  }
};

const tail = (text: string, lines = 20) => text.trimEnd().split("\n").slice(-lines).join("\n");

/**
 * Starts the backing services in the repository's compose file, once per project: every run's app
 * shares them. Services already up are kept as they are (--no-recreate), so a run from another worktree
 * does not recreate a database another run is using. When another stack already holds the services'
 * ports, such as the person's own `docker compose up`, the services are taken as running and `note`
 * says so. Without a compose file there is nothing to do.
 */
export async function ensureServices(root: string, projectId: string, exec: DockerExec = docker, note?: (message: string) => void): Promise<void> {
  const file = COMPOSE_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return;
  if ((await exec(["info"], root)).exitCode !== 0) {
    throw new PreviewError(`Docker is not running, and this repository's ${file} needs it for the app's services. Start Docker and try again.`);
  }
  const up = await exec(["compose", "-p", `handoff-${projectId.slice(0, 8)}`, "-f", file, "up", "-d", "--wait", "--no-recreate"], root);
  if (up.exitCode === 0) return;
  if (/port is already allocated|address already in use/i.test(up.output)) {
    note?.(`A port the services in ${file} need is already in use, most likely by another Docker stack of this repository, so handoff uses the services running there.`);
    return;
  }
  throw new PreviewError(`The services in ${file} did not start:\n${tail(up.output)}`);
}

/** A free port from the system, or `wanted` when the app must have it and it is free. */
async function portFor(wanted: number, exact: boolean): Promise<number> {
  const server = createServer();
  const port = await new Promise<number | undefined>((resolve) => {
    server.once("error", () => resolve(undefined));
    server.listen(exact ? wanted : 0, () => resolve((server.address() as { port: number }).port));
  });
  await new Promise((resolve) => server.close(resolve));
  if (port === undefined) throw new PreviewError(`The app must listen on port ${wanted} (autoPort is false in ${LAUNCH_FILE}), but port ${wanted} is in use.`);
  return port;
}

/** Whether something accepts connections on `port`, over IPv4 or IPv6 (a dev server on localhost may bind either). */
const listening = (port: number) =>
  Promise.all(
    ["127.0.0.1", "::1"].map(
      (host) =>
        new Promise<boolean>((resolve) => {
          const socket = connect({ port, host });
          socket.once("connect", () => (socket.destroy(), resolve(true)));
          socket.once("error", () => resolve(false));
        }),
    ),
  ).then((results) => results.some(Boolean));

/** Where the worktree keeps handoff's files: its git directory, outside the tree. */
async function gitDirOf(path: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: path });
  const gitDir = stdout.trim();
  return isAbsolute(gitDir) ? gitDir : join(path, gitDir);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const signalGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal);
  } catch {
    // already gone
  }
};

/** Stops a process group: SIGTERM, then SIGKILL for whatever is left after a grace period. */
async function stopGroup(pid: number) {
  signalGroup(pid, "SIGTERM");
  const deadline = Date.now() + STOP_GRACE_MS;
  while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  signalGroup(pid, "SIGKILL");
}

export type StartPreviewOptions = {
  runId: string;
  projectId: string;
  workdir: Workdir;
  nodeExecutionId?: string;
  /** The launch configuration to start; the first one when not given. */
  configuration?: string;
  readyTimeoutMs?: number;
  signal?: AbortSignal;
  docker?: DockerExec;
  /** Told about something worth knowing that did not stop the app, such as services already running elsewhere. */
  note?: (message: string) => void;
};

/**
 * Starts a run's app from its worktree, as the repository's `.claude/launch.json` says, and waits until
 * it accepts connections. The app gets a free port in PORT (or its own port when autoPort is false),
 * the project's compose services, and a minimal environment without the worker's tokens. It runs in its
 * own process group, which stopPreview ends. Throws PreviewError saying what to fix when it cannot start.
 */
export async function startPreview(deps: { db: Db; workerId: string }, opts: StartPreviewOptions): Promise<PreviewRow> {
  const { db, workerId } = deps;
  if (opts.workdir.container) throw new PreviewError("Previews do not run in Docker workspaces yet; use the git worktree workspace.");
  const file = join(opts.workdir.path, LAUNCH_FILE);
  if (!existsSync(file)) {
    throw new PreviewError(`This repository has no ${LAUNCH_FILE}, so handoff does not know how to start the app. Add one as Claude Code desktop describes: https://code.claude.com/docs/en/desktop`);
  }
  let launch;
  try {
    launch = parseLaunchFile(readFileSync(file, "utf8"));
  } catch (error) {
    throw new PreviewError((error as Error).message);
  }
  const config = opts.configuration ? launch.configurations.find((c) => c.name === opts.configuration) : launch.configurations[0];
  if (!config) throw new PreviewError(`${LAUNCH_FILE} has no configuration named ${opts.configuration}.`);

  await ensureServices(opts.workdir.path, opts.projectId, opts.docker, opts.note);
  const port = await portFor(config.port, config.autoPort === false);
  const cmd = previewCommand(config, { root: opts.workdir.path, port });
  const id = randomUUID();
  const logPath = join(await gitDirOf(opts.workdir.path), `handoff-preview-${id}.log`);
  await db.insert(previews).values({ id, runId: opts.runId, nodeExecutionId: opts.nodeExecutionId ?? null, configuration: config.name, workerId, port, url: cmd.url, logPath });

  const log = openSync(logPath, "a");
  // The app is code the agent wrote: it gets the same minimal environment as test commands, without CI.
  const { CI: _ci, ...base } = commandEnv();
  const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: { ...base, ...cmd.env } as NodeJS.ProcessEnv, stdio: ["ignore", log, log], detached: true });
  closeSync(log);
  child.unref();
  let exit: number | null | undefined;
  let spawnError: Error | undefined;
  child.once("exit", (code, signal) => (exit = code ?? (signal ? -1 : null)));
  child.once("error", (error) => (spawnError = error));
  await db.update(previews).set({ pid: child.pid ?? null }).where(eq(previews.id, id));

  const fail = async (message: string): Promise<never> => {
    if (child.pid) await stopGroup(child.pid);
    await db.update(previews).set({ status: "failed", error: message, stoppedAt: new Date() }).where(eq(previews.id, id));
    throw new PreviewError(message);
  };
  const output = () => (existsSync(logPath) ? tail(readFileSync(logPath, "utf8")) : "");
  const deadline = Date.now() + (opts.readyTimeoutMs ?? READY_TIMEOUT_MS);
  for (;;) {
    if (spawnError) return fail(`The app could not start: ${spawnError.message}`);
    if (exit !== undefined) return fail(`The app exited with code ${exit} before it was up:\n${output()}`);
    if (opts.signal?.aborted) return fail("The step that started the app was stopped.");
    if (await listening(port)) break;
    if (Date.now() > deadline) {
      return fail(
        `The app did not listen on port ${port} in time. Handoff passes the port in PORT, as Claude Code desktop does; make the dev command read PORT instead of a fixed port, or set autoPort to false in ${LAUNCH_FILE}.\n${output()}`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const [row] = await db.update(previews).set({ status: "running" }).where(eq(previews.id, id)).returning();
  return row!;
}

/** Stops a preview's process group and marks it stopped. Stopping one that already ended does nothing. */
export async function stopPreview(db: Db, id: string): Promise<void> {
  const [row] = await db.select().from(previews).where(eq(previews.id, id));
  if (!row || (row.status !== "starting" && row.status !== "running")) return;
  if (row.pid) await stopGroup(row.pid);
  await db.update(previews).set({ status: "stopped", stoppedAt: new Date() }).where(eq(previews.id, id));
}

/** Stops the previews a step started, when the step is done with them. */
export async function stopStepPreviews(db: Db, nodeExecutionId: string): Promise<void> {
  const rows = await db.select({ id: previews.id }).from(previews).where(and(eq(previews.nodeExecutionId, nodeExecutionId), inArray(previews.status, ["starting", "running"])));
  await Promise.all(rows.map((r) => stopPreview(db, r.id)));
}

/** Stops every preview of a run, when the run is cancelled. */
export async function stopRunPreviews(db: Db, runId: string): Promise<void> {
  const rows = await db.select({ id: previews.id }).from(previews).where(and(eq(previews.runId, runId), inArray(previews.status, ["starting", "running"])));
  await Promise.all(rows.map((r) => stopPreview(db, r.id)));
}

/** Stops the previews a worker left running, when it starts again: nothing would stop them otherwise. */
export async function stopWorkerPreviews(db: Db, workerId: string): Promise<void> {
  const rows = await db.select({ id: previews.id }).from(previews).where(and(eq(previews.workerId, workerId), inArray(previews.status, ["starting", "running"])));
  await Promise.all(rows.map((r) => stopPreview(db, r.id)));
}
