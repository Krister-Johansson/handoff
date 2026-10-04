import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import {
  demoConfiguration,
  LAUNCH_FILE,
  LaunchConfigurationSchema,
  parseLaunchFile,
  passEnvProblem,
  pickEnv,
  previewCommand,
  type LaunchConfiguration,
  type PreviewCommand,
} from "@handoff/core";
import { and, eq, inArray, liveWorkers, previews, workers, type Db } from "@handoff/db";
import { commandEnv, shell } from "../contract/checks.ts";
import type { Workdir } from "../types.ts";
import { runIdentity } from "../workdir/setup.ts";

const execFileAsync = promisify(execFile);
const READY_TIMEOUT_MS = 120_000;
const STOP_GRACE_MS = 5_000;
const SERVICES_TIMEOUT_MS = 5 * 60_000;
const SEED_TIMEOUT_MS = 10 * 60_000;
const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

/**
 * A run's app could not start; the message says why in terms a person can act on. `summary` is that
 * sentence alone and `log` the end of the output it quotes, when there is one; the message holds both.
 */
export class PreviewError extends Error {
  readonly summary: string;
  constructor(
    summary: string,
    readonly log?: string,
  ) {
    super(log ? `${summary}\n${log}` : summary);
    this.summary = summary;
  }
}

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

/** The repository's compose file, by the names Docker Compose looks for; undefined without one. */
export const composeFileOf = (root: string) => COMPOSE_FILES.find((name) => existsSync(join(root, name)));

/** The end of an app's output so far: its last `lines` lines, or "" before it wrote any. */
export const logTail = (logPath: string, lines = 20) => (existsSync(logPath) ? tail(readFileSync(logPath, "utf8"), lines) : "");

/**
 * Starts the backing services in the repository's compose file, once per project: every run's app
 * shares them. Services already up are kept as they are (--no-recreate), so a run from another worktree
 * does not recreate a database another run is using. When another stack already holds the services'
 * ports, such as the person's own `docker compose up`, the services are taken as running and `note`
 * says so. Without a compose file there is nothing to do.
 */
export async function ensureServices(root: string, projectId: string, exec: DockerExec = docker, note?: (message: string) => void): Promise<void> {
  const file = composeFileOf(root);
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
  throw new PreviewError(`The services in ${file} did not start:`, tail(up.output));
}

/** Where a configuration came from: the repository's launch file, or the project's App launch setting. */
export type LaunchSource = "file" | "setting";

/** How a message names the switch that makes the app keep its own port, where the person sets it. */
const exactPortSwitch = (source: LaunchSource) => (source === "file" ? `autoPort is false in ${LAUNCH_FILE}` : "Any free port is off in App launch");

/** A free port from the system, or `wanted` when the app must have it and it is free. */
async function portFor(wanted: number, exact: boolean, source: LaunchSource): Promise<number> {
  const server = createServer();
  const port = await new Promise<number | undefined>((resolve) => {
    server.once("error", () => resolve(undefined));
    server.listen(exact ? wanted : 0, () => resolve((server.address() as { port: number }).port));
  });
  await new Promise((resolve) => server.close(resolve));
  if (port === undefined) throw new PreviewError(`The app must listen on port ${wanted} (${exactPortSwitch(source)}), but port ${wanted} is in use.`);
  return port;
}

/**
 * The configuration to start from the worktree at `root`: the repository's launch file wins, then the
 * project's App launch setting. Throws PreviewError when there is neither, or when the one there is wrong.
 */
export function launchConfigurationFor(root: string, opts: { configuration?: string; launch?: unknown }): { config: LaunchConfiguration; source: LaunchSource } {
  const file = join(root, LAUNCH_FILE);
  if (existsSync(file)) {
    let launch;
    try {
      launch = parseLaunchFile(readFileSync(file, "utf8"));
    } catch (error) {
      throw new PreviewError((error as Error).message);
    }
    const config = opts.configuration ? launch.configurations.find((c) => c.name === opts.configuration) : demoConfiguration(launch);
    if (!config) throw new PreviewError(`${LAUNCH_FILE} has no configuration named ${opts.configuration}.`);
    return { config, source: "file" };
  }
  if (opts.launch) {
    const setting = LaunchConfigurationSchema.safeParse(opts.launch);
    if (!setting.success || (!setting.data.runtimeExecutable && !setting.data.program)) {
      throw new PreviewError("The project's App launch setting cannot be read. Open Project settings, App launch, and save it again.");
    }
    return { config: setting.data, source: "setting" };
  }
  throw new PreviewError(
    `This repository has no ${LAUNCH_FILE} and the project has no App launch setting, so handoff does not know how to start the app. ` +
      "Set the command in Project settings, App launch, or add the file as Claude Code desktop describes: https://code.claude.com/docs/en/desktop",
  );
}

/** What one step of starting an app is doing, for a person watching it start. */
export type LaunchStepEvent = { step: "services" | "seed" | "app"; status: "running" | "done" | "failed"; detail: string };

/** A started app: its process group's leader, its port, where it is reached and where its output goes. */
export type LaunchedApp = { pid: number | undefined; port: number; url: string; logPath: string };

export type LaunchAppOptions = {
  /** The worktree to start the app from. */
  root: string;
  projectId: string;
  config: LaunchConfiguration;
  source: LaunchSource;
  /** Variables that name the worktree the app runs from, such as the run's identity. */
  identity: Record<string, string>;
  seedCommand?: string | null;
  passEnv?: readonly string[];
  readyTimeoutMs?: number;
  signal?: AbortSignal;
  docker?: DockerExec;
  note?: (message: string) => void;
  /** Told as each step starts and ends. */
  onStep?: (event: LaunchStepEvent) => void;
  /** Told once the app's process is spawned, before it is up. */
  onSpawn?: (app: LaunchedApp) => Promise<void>;
};

/**
 * Starts an app from a worktree and waits until it accepts connections: the compose services, the seed
 * command, then the app in its own process group with a minimal environment, on a free port passed in
 * PORT (or its own port when it must have it). An app that does not come up is stopped, and PreviewError
 * says why, with the end of its output.
 */
export async function launchApp(o: LaunchAppOptions): Promise<LaunchedApp> {
  const step = (s: LaunchStepEvent["step"], status: LaunchStepEvent["status"], detail: string) => o.onStep?.({ step: s, status, detail });
  const passEnv = o.passEnv ?? [];

  const compose = composeFileOf(o.root);
  let shared = false;
  step("services", "running", compose ? `Starting the services in ${compose}` : "None in the repository");
  try {
    await ensureServices(o.root, o.projectId, o.docker, (message) => ((shared = true), o.note?.(message)));
  } catch (error) {
    step("services", "failed", (error as PreviewError).summary ?? (error as Error).message);
    throw error;
  }
  step("services", "done", compose ? (shared ? `${compose}: already running in another stack` : `${compose}: up`) : "None in the repository");

  const seedCommand = o.seedCommand?.trim();
  if (seedCommand) {
    step("seed", "running", `\`${seedCommand}\``);
    const seed = await shell(seedCommand, o.root, SEED_TIMEOUT_MS, undefined, passEnv, o.signal, o.identity);
    if (seed.timedOut || seed.exitCode !== 0) {
      const why = seed.timedOut ? `timed out after ${SEED_TIMEOUT_MS / 60_000} minutes` : `exited ${seed.exitCode}`;
      step("seed", "failed", `\`${seedCommand}\` ${why}`);
      throw new PreviewError(`The project's demo seed command \`${seedCommand}\` ${why}:`, tail(seed.output));
    }
    step("seed", "done", `\`${seedCommand}\` exited 0`);
  } else {
    step("seed", "done", "None");
  }

  let port: number;
  let cmd: PreviewCommand;
  try {
    port = await portFor(o.config.port, o.config.autoPort === false, o.source);
    cmd = previewCommand(o.config, { root: o.root, port });
  } catch (error) {
    const message = error instanceof PreviewError ? error.summary : (error as Error).message;
    step("app", "failed", message);
    throw error instanceof PreviewError ? error : new PreviewError(message);
  }
  const logPath = join(await gitDirOf(o.root), `handoff-preview-${randomUUID()}.log`);
  step("app", "running", `Waiting for port ${port}`);

  const log = openSync(logPath, "a");
  // The app is code the agent wrote: it gets the same minimal environment as test commands, without CI,
  // plus the worktree's identity and the variables passEnv names.
  const { CI: _ci, ...base } = commandEnv();
  const env = { ...base, ...pickEnv(passEnv, process.env), ...o.identity, ...cmd.env };
  const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: env as NodeJS.ProcessEnv, stdio: ["ignore", log, log], detached: true });
  closeSync(log);
  child.unref();
  let exit: number | null | undefined;
  let spawnError: Error | undefined;
  child.once("exit", (code, signal) => (exit = code ?? (signal ? -1 : null)));
  child.once("error", (error) => (spawnError = error));
  const app = { pid: child.pid, port, url: cmd.url, logPath };
  await o.onSpawn?.(app);

  const fail = async (detail: string, summary: string, withLog = true): Promise<never> => {
    if (child.pid) await stopGroup(child.pid);
    step("app", "failed", detail);
    throw new PreviewError(summary, withLog ? logTail(logPath) || undefined : undefined);
  };
  const deadline = Date.now() + (o.readyTimeoutMs ?? READY_TIMEOUT_MS);
  for (;;) {
    if (spawnError) return fail(`Could not start: ${spawnError.message}`, `The app could not start: ${spawnError.message}`, false);
    if (exit !== undefined) return fail(`Exited with code ${exit}`, `The app exited with code ${exit} before it was up:`);
    if (o.signal?.aborted) return fail("Stopped", "The step that started the app was stopped.", false);
    if (await listening(port)) break;
    if (Date.now() > deadline) {
      const fix = o.source === "file" ? `set autoPort to false in ${LAUNCH_FILE}` : "turn off Any free port in App launch";
      return fail(
        `Started, but nothing listened on port ${port}`,
        `The app did not listen on port ${port} in time. Handoff passes the port in PORT, as Claude Code desktop does; make the dev command read PORT instead of a fixed port, or ${fix}.`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  step("app", "done", `Listening on port ${port}`);
  return app;
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
export async function stopGroup(pid: number) {
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
  /** The launch configuration to start; the one named handoff-demo, else the first, when not given. */
  configuration?: string;
  readyTimeoutMs?: number;
  signal?: AbortSignal;
  docker?: DockerExec;
  /** Told about something worth knowing that did not stop the app, such as services already running elsewhere. */
  note?: (message: string) => void;
  /** A command that seeds data to show, run in the worktree after the services start and before the app. */
  seedCommand?: string | null;
  /** Names of variables the seed command and the app get from the worker's own environment. Never values. */
  passEnv?: readonly string[];
  /** The project's App launch setting: how to start the app when the repository has no launch file. */
  launch?: unknown;
};

/**
 * Starts a run's app from its worktree, as the repository's `.claude/launch.json` says, or else as the
 * project's App launch setting says, and waits until it accepts connections. The app gets a free port in
 * PORT (or its own port when autoPort is false), the project's compose services, and a minimal environment
 * without the worker's tokens. It runs in its own process group, which stopPreview ends. Throws
 * PreviewError saying what to fix when it cannot start.
 */
export async function startPreview(deps: { db: Db; workerId: string }, opts: StartPreviewOptions): Promise<PreviewRow> {
  const { db, workerId } = deps;
  if (opts.workdir.container) throw new PreviewError("Previews do not run in Docker workspaces yet; use the git worktree workspace.");
  const { config, source } = launchConfigurationFor(opts.workdir.path, opts);
  const problem = passEnvProblem(opts.passEnv ?? []);
  if (problem) throw new PreviewError(problem);

  const id = randomUUID();
  let inserted = false;
  try {
    await launchApp({
      ...opts,
      root: opts.workdir.path,
      config,
      source,
      identity: runIdentity(opts.runId, opts.workdir.path),
      onSpawn: async (app) => {
        await db.insert(previews).values({ id, runId: opts.runId, nodeExecutionId: opts.nodeExecutionId ?? null, configuration: config.name, workerId, pid: app.pid ?? null, port: app.port, url: app.url, logPath: app.logPath });
        inserted = true;
      },
    });
  } catch (error) {
    if (inserted && error instanceof PreviewError) await db.update(previews).set({ status: "failed", error: error.message, stoppedAt: new Date() }).where(eq(previews.id, id));
    throw error;
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

/** Stops the previews started under one worker id. */
export async function stopWorkerPreviews(db: Db, workerId: string): Promise<void> {
  const rows = await db.select({ id: previews.id }).from(previews).where(and(eq(previews.workerId, workerId), inArray(previews.status, ["starting", "running"])));
  await Promise.all(rows.map((r) => stopPreview(db, r.id)));
}

/** A worker that has not heartbeated for this long is taken as gone, as the dashboard takes it. */
export const LIVE_WORKER_WINDOW_MS = 60_000;

/**
 * Stops the previews that worker processes on this host left running, when a worker starts: nothing
 * would stop them otherwise. That is its own id's previews, from the process before it, and those of
 * any worker that is no longer live (stopped, or silent past the window), whatever its id: the default
 * id holds the pid and changes with every restart. A live worker's previews are left alone, and so are
 * those of workers on other hosts, whose pids mean nothing here.
 */
export async function stopLeftPreviews(db: Db, opts: { workerId: string; windowMs?: number; host?: string }): Promise<void> {
  const live = new Set((await liveWorkers(db, opts.windowMs ?? LIVE_WORKER_WINDOW_MS)).map((w) => w.id));
  const rows = await db
    .select({ id: previews.id, workerId: previews.workerId })
    .from(previews)
    .innerJoin(workers, eq(workers.id, previews.workerId))
    .where(and(eq(workers.hostname, opts.host ?? hostname()), inArray(previews.status, ["starting", "running"])));
  const left = rows.filter((r) => r.workerId === opts.workerId || !live.has(r.workerId));
  await Promise.all(left.map((r) => stopPreview(db, r.id)));
}
