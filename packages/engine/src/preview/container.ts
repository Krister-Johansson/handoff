import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import type { DockerExec } from "./preview.ts";
import { PreviewError } from "./preview.ts";

const execFileAsync = promisify(execFile);

/** How long the processes in an app's container get to end after SIGTERM, as in worktree mode. */
const STOP_GRACE_MS = 5_000;

/** How many new ports a preview tries after the first one turns out to be taken. */
const NEW_PORT_TRIES = 3;

/** The container's own processes once the app's are gone: docker-init and the main process. */
const OWN_PROCESSES = 2;

/**
 * The main process: it ignores SIGTERM, so stopping the app's processes with `kill -TERM -1` leaves the
 * container up for the grace period instead of ending everything at once.
 */
const KEEP_ALIVE = ["sh", "-c", 'trap "" TERM; exec sleep infinity'];

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

export type PreviewContainerSpec = {
  previewId: string;
  runId: string;
  workerId?: string;
  /** The run container's settings, from siblingOf. */
  of: SiblingConfig;
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
 */
export async function startPreviewContainer(spec: PreviewContainerSpec, ports: PreviewPorts, exec: DockerExec = dockerExec): Promise<PreviewContainer> {
  const name = previewContainerName(spec.previewId);
  const { of } = spec;
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
        `handoff.preview=${spec.previewId}`,
        "--label",
        `handoff.run=${spec.runId}`,
        ...(spec.workerId ? ["--label", `handoff.worker=${spec.workerId}`] : []),
        ...(of.user ? ["--user", of.user] : []),
        ...(of.network ? ["--network", of.network] : []),
        ...of.env.flatMap((e) => ["-e", e]),
        ...of.binds.flatMap((b) => ["-v", b]),
        ...addresses.flatMap((a) => ["-p", `${a.includes(":") ? `[${a}]` : a}:${port}:${port}`]),
        "-w",
        of.workdir,
        of.image,
        ...KEEP_ALIVE,
      ],
      process.cwd(),
    );
    if (run.exitCode === 0) return { name, port, addresses };
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
