import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";
import type { Workdir, WorkdirProvider, WorkdirSpec } from "../types.ts";
import type { GitWorktreeProvider } from "./git-worktree.ts";

const run = promisify(execFile);

export type DockerWorkdirOptions = {
  git: GitWorktreeProvider;
  /** Image with sh, git and the pinned claude CLI (see docker/runner.Dockerfile). */
  image: string;
  /** Host paths mounted at the same path inside the container: HANDOFF_HOME at least. */
  mounts: string[];
  /** Docker network for the container, for example an egress-restricted network. */
  network?: string;
  /** uid:gid to run as, so files written into the worktree belong to the host user. */
  user?: string;
  /** Author and committer for commits made inside the container. */
  gitIdentity?: { name: string; email: string };
};

/**
 * One container per run. Git worktrees stay on the host (GitWorktreeProvider); the container mounts
 * them, the staging dir and the Claude config dir at identical paths, so every path in the claude
 * argv resolves the same inside and out. Commands run through `docker exec`.
 */
export class DockerWorkdirProvider implements WorkdirProvider {
  constructor(private readonly options: DockerWorkdirOptions) {}

  containerName(runId: string) {
    return `handoff-${runId}`;
  }

  async acquire(spec: WorkdirSpec): Promise<Workdir> {
    const workdir = await this.options.git.acquire(spec);
    const name = this.containerName(spec.runId);
    const state = await run("docker", ["inspect", "-f", "{{.State.Running}}", name]).then(
      (r) => r.stdout.trim(),
      () => "missing",
    );
    if (state === "false") await run("docker", ["start", name]);
    if (state === "missing") {
      for (const mount of this.options.mounts) mkdirSync(mount, { recursive: true });
      const user = this.options.user ?? (process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : undefined);
      await run("docker", [
        "run",
        "-d",
        "--name",
        name,
        "--label",
        "handoff.run=" + spec.runId,
        "-e",
        "HOME=/tmp",
        ...gitIdentityEnv(this.options.gitIdentity ?? { name: "handoff", email: "handoff@users.noreply.github.com" }),
        ...(user ? ["--user", user] : []),
        ...(this.options.network ? ["--network", this.options.network] : []),
        ...[...new Set([...this.options.mounts, workdir.path])].flatMap((m) => ["-v", `${m}:${m}`]),
        "-w",
        workdir.path,
        this.options.image,
        "sleep",
        "infinity",
      ]);
    }
    return { ...workdir, container: name };
  }

  async release(spec: WorkdirSpec): Promise<void> {
    await run("docker", ["rm", "-f", this.containerName(spec.runId)]).catch(() => {});
    await this.options.git.release(spec);
  }
}

const gitIdentityEnv = (id: { name: string; email: string }) =>
  [`GIT_AUTHOR_NAME=${id.name}`, `GIT_AUTHOR_EMAIL=${id.email}`, `GIT_COMMITTER_NAME=${id.name}`, `GIT_COMMITTER_EMAIL=${id.email}`].flatMap((v) => ["-e", v]);
