import { resolve } from "node:path";
import { z } from "zod";
import type { DockerWorkdirOptions } from "./docker.ts";

/** What a run's container and its app's container are made from, the same for the worker and the dashboard. */
export type DockerOptions = Pick<DockerWorkdirOptions, "image" | "mounts" | "network" | "user">;

const optional = z.string().trim().min(1).optional().catch(undefined);

const Schema = z.object({
  HANDOFF_HOME: z.string().trim().min(1).catch("./.handoff").default("./.handoff"),
  HANDOFF_DOCKER_IMAGE: z.string().trim().min(1).catch("handoff-runner:2.1.285").default("handoff-runner:2.1.285"),
  /** Extra host paths mounted into run containers, comma separated. */
  HANDOFF_DOCKER_MOUNTS: optional,
  HANDOFF_DOCKER_NETWORK: optional,
});

/**
 * The Docker workspace options from the environment: the image, HANDOFF_HOME (resolved from the
 * current directory) followed by HANDOFF_DOCKER_MOUNTS, the network when set, and this process's
 * uid:gid so files written into the worktree belong to the host user. Empty values count as unset.
 */
export function dockerOptionsFromEnv(env: Record<string, string | undefined>): DockerOptions {
  const set = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = Schema.parse(set);
  const extra = parsed.HANDOFF_DOCKER_MOUNTS?.split(",").map((m) => m.trim()).filter(Boolean) ?? [];
  const user = process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : undefined;
  return {
    image: parsed.HANDOFF_DOCKER_IMAGE,
    mounts: [resolve(parsed.HANDOFF_HOME), ...extra],
    ...(parsed.HANDOFF_DOCKER_NETWORK ? { network: parsed.HANDOFF_DOCKER_NETWORK } : {}),
    ...(user ? { user } : {}),
  };
}
