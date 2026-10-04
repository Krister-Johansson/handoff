import { execFile } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { FORWARDER_FILE, FORWARDER_READY, forwarderScript } from "./forward.ts";
import type { DockerExec } from "./preview.ts";
import { PreviewError } from "./preview.ts";

const execFileAsync = promisify(execFile);

/** How long the processes in an app's container get to end after SIGTERM, as in worktree mode. */
const STOP_GRACE_MS = 5_000;

/** How many new ports a preview tries after the first one turns out to be taken. */
const NEW_PORT_TRIES = 3;

/** The container's own processes once the app's are gone: docker-init and the forwarder. */
const OWN_PROCESSES = 2;

/** How long a new container's forwarder gets to listen on the service ports. */
const FORWARDER_READY_MS = 10_000;

/** How long the services check waits for each connection from inside the container. */
const REACH_TIMEOUT_MS = 3_000;

/** Connects from inside the container to host.docker.internal on each port in its arguments and prints "<port> <why>" for each that fails. */
const REACH_SCRIPT = `const { connect } = require("node:net");
for (const port of process.argv.slice(1).map(Number)) {
  const socket = connect({ host: "host.docker.internal", port, timeout: ${REACH_TIMEOUT_MS} });
  socket.once("connect", () => socket.destroy());
  socket.once("timeout", () => (console.log(port + " timed out"), socket.destroy()));
  socket.once("error", (error) => console.log(port + " " + error.message));
}`;

const dockerExec: DockerExec = async (args, cwd) => {
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, { cwd, timeout: 5 * 60_000 });
    return { exitCode: 0, output: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string; message: string };
    return { exitCode: typeof e.code === "number" ? e.code : 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` || e.message };
  }
};

const tail = (text: string, lines = 20) => text.trimEnd().split("\n").slice(-lines).join("\n");

/** What an app's container copies from its run's container, so the two never drift apart. */
export type SiblingConfig = {
  image: string;
  user?: string;
  /** NAME=value entries, the image's own included. */
  env: string[];
  /** host:container mounts as `docker run -v` takes them. */
  binds: string[];
  network?: string;
  workdir: string;
};

const realOrSelf = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * Where a host path is inside a container with `binds`, or undefined when no mount holds it. A mount
 * matches by its own path or by its real path, since git reports a worktree's git directory with
 * symbolic links resolved (on macOS, /var/folders is /private/var/folders).
 */
export function mountedPath(hostPath: string, binds: string[]): string | undefined {
  const real = realOrSelf(hostPath);
  for (const bind of binds) {
    const [host, target = host] = bind.split(":");
    if (!host) continue;
    for (const [from, path] of [
      [host, hostPath],
      [realOrSelf(host), real],
    ] as const) {
      if (path === from || path.startsWith(`${from.replace(/\/$/, "")}/`)) return target + path.slice(from.replace(/\/$/, "").length);
    }
  }
  return undefined;
}

/** The container a preview's app runs in: `handoff-preview-` and the first 8 characters of the preview's id. */
export const previewContainerName = (previewId: string) => `handoff-preview-${previewId.slice(0, 8)}`;

/** Reads the image, user, environment, mounts, network and working directory of the run's container. */
export async function siblingOf(runContainer: string, exec: DockerExec = dockerExec): Promise<SiblingConfig> {
  const result = await exec(["inspect", runContainer], process.cwd());
  if (result.exitCode !== 0) throw new PreviewError(`The run's container ${runContainer} could not be read:`, tail(result.output));
  const [container] = JSON.parse(result.output) as [
    { Config: { Image: string; User?: string; Env?: string[] | null; WorkingDir: string }; HostConfig: { Binds?: string[] | null; NetworkMode?: string } },
  ];
  const { Config: config, HostConfig: host } = container;
  return {
    image: config.Image,
    ...(config.User ? { user: config.User } : {}),
    env: config.Env ?? [],
    binds: host.Binds ?? [],
    ...(host.NetworkMode && host.NetworkMode !== "default" ? { network: host.NetworkMode } : {}),
    workdir: config.WorkingDir,
  };
}

/**
 * The label that carries the app's id: handoff.preview for a run's app, which a starting worker removes
 * unless its preview row runs, and handoff.launch-test for a Test start's, which has no preview row.
 */
export type PreviewLabel = "handoff.preview" | "handoff.launch-test";

export type PreviewContainerSpec = {
  previewId: string;
  /** handoff.preview when not given. */
  label?: PreviewLabel;
  runId: string;
  workerId?: string;
  /** The run container's settings, from siblingOf. */
  of: SiblingConfig;
  /**
   * The services' host ports to forward from localhost inside the container (servicePorts), and the
   * folder the forwarder script is written to. The folder must be mounted at the same path in the
   * container, as the worktree's git directory under HANDOFF_HOME is.
   */
  forward: { ports: number[]; dir: string };
};

/** The host port to try first, and where a new free port comes from when it is taken; without `next` the app must have `first`. */
export type PreviewPorts = { first: number; next?: () => Promise<number> };

export type PreviewContainer = {
  name: string;
  /** The same number on the host and inside the container. */
  port: number;
  /** The loopback addresses the port is published on: 127.0.0.1, and ::1 unless Docker refused it. */
  addresses: string[];
};

const portTaken = (output: string) => /port is already allocated|address already in use/i.test(output);
const ipv6Refused = (output: string) => /\[::1\]|tcp6/i.test(output);

/**
 * Starts the container a run's app runs in, next to the run's container and made like it: same image,
 * user, environment, mounts, network and working directory, with `--init` and the labels cleanup finds
 * it by. The app's port is published on the loopback addresses only, as the same number inside and
 * out. A port taken before `docker run` gets a new one from `ports.next`, up to three times; when
 * Docker refuses [::1], the port is published on 127.0.0.1 alone. A container Docker created but could
 * not start is removed before the next try or the failure.
 *
 * The container's main process is the forwarder (forward.ts), which makes the services' ports answer at
 * localhost inside it through host.docker.internal; `--add-host host.docker.internal:host-gateway`
 * makes that name resolve on Linux too. It returns once the forwarder listens.
 */
export async function startPreviewContainer(spec: PreviewContainerSpec, ports: PreviewPorts, exec: DockerExec = dockerExec): Promise<PreviewContainer> {
  const name = previewContainerName(spec.previewId);
  const { of, forward } = spec;
  const script = join(forward.dir, FORWARDER_FILE);
  writeFileSync(script, forwarderScript);
  let port = ports.first;
  let addresses = ["127.0.0.1", "::1"];
  for (let newPorts = 0; ; ) {
    const run = await exec(
      [
        "run",
        "-d",
        "--init",
        "--name",
        name,
        "--label",
        `${spec.label ?? "handoff.preview"}=${spec.previewId}`,
        "--label",
        `handoff.run=${spec.runId}`,
        ...(spec.workerId ? ["--label", `handoff.worker=${spec.workerId}`] : []),
        ...(of.user ? ["--user", of.user] : []),
        ...(of.network ? ["--network", of.network] : []),
        ...of.env.flatMap((e) => ["-e", e]),
        ...of.binds.flatMap((b) => ["-v", b]),
        ...addresses.flatMap((a) => ["-p", `${a.includes(":") ? `[${a}]` : a}:${port}:${port}`]),
        "--add-host",
        "host.docker.internal:host-gateway",
        "-w",
        of.workdir,
        of.image,
        "node",
        script,
        ...forward.ports.filter((p) => p !== port).map(String),
      ],
      process.cwd(),
    );
    if (run.exitCode === 0) {
      await forwarderListens(name, exec);
      return { name, port, addresses };
    }
    await exec(["rm", "-f", name], process.cwd());
    if (portTaken(run.output)) {
      if (!ports.next) throw new PreviewError(`Port ${port} is in use, so Docker could not publish the app's port:`, tail(run.output));
      if (newPorts++ >= NEW_PORT_TRIES) throw new PreviewError(`Docker found every port handoff tried for the app in use, the last one ${port}:`, tail(run.output));
      port = await ports.next();
    } else if (addresses.includes("::1") && ipv6Refused(run.output)) {
      addresses = ["127.0.0.1"];
    } else {
      throw new PreviewError(`The app's container ${name} did not start:`, tail(run.output));
    }
  }
}

/** Waits until the container's forwarder says it listens; a forwarder that fails or stays silent removes the container. */
async function forwarderListens(name: string, exec: DockerExec): Promise<void> {
  const deadline = Date.now() + FORWARDER_READY_MS;
  let logs = "";
  for (;;) {
    logs = (await exec(["logs", name], process.cwd())).output;
    if (logs.includes(FORWARDER_READY)) return;
    if (logs.includes("handoff-forward:") || Date.now() > deadline) break;
    await sleep(100);
  }
  await exec(["rm", "-f", name], process.cwd());
  throw new PreviewError(`The app's container ${name} did not start forwarding the services' ports:`, tail(logs) || undefined);
}

const listed = (ports: number[]) => (ports.length === 1 ? `port ${ports[0]}` : `ports ${ports.slice(0, -1).join(", ")} and ${ports.at(-1)}`);

/**
 * The services check: opens one connection from inside the app's container to host.docker.internal on
 * each forwarded port. A port it cannot reach fails with a message that names it. On Docker Desktop
 * that means nothing listens there; on Linux, also a service published on 127.0.0.1 only, which a
 * container cannot reach through host-gateway.
 */
export async function reachServices(container: string, ports: number[], exec: DockerExec = dockerExec): Promise<void> {
  if (ports.length === 0) return;
  const check = await exec(["exec", container, "node", "-e", REACH_SCRIPT, ...ports.map(String)], process.cwd());
  if (check.exitCode !== 0) throw new PreviewError(`The services check could not run in the app's container ${container}:`, tail(check.output));
  const failures = check.output.split("\n").filter((line) => /^\d+ /.test(line));
  if (failures.length === 0) return;
  const unreachable = failures.map((line) => Number(line.split(" ")[0]));
  const first = unreachable[0];
  throw new PreviewError(
    `The app's container could not reach ${listed(unreachable)} on this machine through host.docker.internal, so the app cannot reach ${unreachable.length === 1 ? "that service" : "those services"} at localhost. Check that the service runs. On Linux a container reaches only ports published on all addresses: publish it as "${first}:${first}", not "127.0.0.1:${first}:${first}", or use worktree mode (HANDOFF_WORKSPACE=worktree).`,
    failures.join("\n"),
  );
}

/**
 * Connects inside the container to the port in its arguments, on the loopback addresses and on the
 * container's own addresses, and prints where something listens: "outside", "loopback" or "none".
 */
const PROBE_SCRIPT = `const { connect } = require("node:net");
const { networkInterfaces } = require("node:os");
const port = Number(process.argv[1]);
const own = Object.values(networkInterfaces()).flat().filter((i) => !i.internal).map((i) => i.address.split("%")[0]);
const open = (host) => new Promise((resolve) => {
  const socket = connect({ host, port, timeout: 2000 });
  socket.once("connect", () => (socket.destroy(), resolve(true)));
  socket.once("timeout", () => (socket.destroy(), resolve(false)));
  socket.once("error", () => resolve(false));
});
const any = async (hosts) => (await Promise.all(hosts.map(open))).some(Boolean);
(async () => console.log((await any(own)) ? "outside" : (await any(["127.0.0.1", "::1"])) ? "loopback" : "none"))();`;

/**
 * Where the app listens on `port` inside its container, to explain why it did not answer through the
 * published port: on an address a published port reaches ("outside"), on loopback only ("loopback"),
 * or not at all ("none", also when the probe cannot run).
 */
export async function probeInside(container: string, port: number, exec: DockerExec = dockerExec): Promise<"outside" | "loopback" | "none"> {
  const probe = await exec(["exec", container, "node", "-e", PROBE_SCRIPT, String(port)], process.cwd());
  const where = probe.output.trim().split("\n").at(-1);
  return probe.exitCode === 0 && (where === "outside" || where === "loopback") ? where : "none";
}

/** Whether an app's container exists and runs. */
export async function containerRunning(name: string, exec: DockerExec = dockerExec): Promise<boolean> {
  const state = await exec(["inspect", "-f", "{{.State.Running}}", name], process.cwd());
  return state.exitCode === 0 && state.output.trim() === "true";
}

/**
 * Stops an app's container as worktree mode stops an app: SIGTERM to every process in it, up to 5
 * seconds for them to end, then `docker rm -f`. A container that is already gone is fine.
 */
export async function removePreviewContainer(name: string, exec: DockerExec = dockerExec, graceMs = STOP_GRACE_MS): Promise<void> {
  const cwd = process.cwd();
  const signalled = await exec(["exec", name, "sh", "-c", "kill -TERM -1"], cwd);
  if (signalled.exitCode === 0) {
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      const top = await exec(["top", name], cwd);
      if (top.exitCode !== 0 || top.output.trim().split("\n").length - 1 <= OWN_PROCESSES) break;
      await sleep(100);
    }
  }
  await exec(["rm", "-f", name], cwd);
}
