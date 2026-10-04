import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Db } from "@handoff/db";
import { DockerWorkdirProvider, GitWorktreeProvider } from "@handoff/engine/launch-test";
import { launchTestDeps } from "./app-launch";

// launchTestDeps only holds on to the database.
const db = {} as Db;
const repo = { owner: "octo", name: "shop" };

test("Docker workspace mode makes Test start's worktree with containers", () => {
  const env = { HANDOFF_WORKSPACE: "docker", HANDOFF_HOME: "/srv/handoff", HANDOFF_DOCKER_IMAGE: "runner:1", HANDOFF_DOCKER_MOUNTS: "/srv/cache", HANDOFF_DOCKER_NETWORK: "egress" };
  const { workdirs } = launchTestDeps(db, undefined, repo, env);
  expect(workdirs).toBeInstanceOf(DockerWorkdirProvider);
  // The worker's options, so a Test start's containers are made like a run's.
  expect(workdirs).toMatchObject({ options: { image: "runner:1", mounts: ["/srv/handoff", "/srv/cache"], network: "egress", git: expect.any(GitWorktreeProvider) } });
  expect((workdirs as unknown as { options: { git: GitWorktreeProvider } }).options.git.worktreePath("t1")).toBe("/srv/handoff/worktrees/t1");
});

test("without HANDOFF_HOME the containers mount the folder the worktrees are made in", () => {
  const { workdirs } = launchTestDeps(db, undefined, repo, { HANDOFF_WORKSPACE: "docker" });
  expect(workdirs).toMatchObject({ options: { mounts: [join(homedir(), ".handoff")] } });
});

test("worktree mode makes a plain git worktree", () => {
  const { workdirs } = launchTestDeps(db, undefined, repo, { HANDOFF_WORKSPACE: "worktree", HANDOFF_HOME: "/srv/handoff" });
  expect(workdirs).toBeInstanceOf(GitWorktreeProvider);
  expect((workdirs as GitWorktreeProvider).worktreePath("t1")).toBe("/srv/handoff/worktrees/t1");
});
