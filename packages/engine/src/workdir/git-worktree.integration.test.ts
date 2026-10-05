import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createOriginRepo, flakyFetches, git, landOnMain } from "../testing/git.ts";
import { GitWorktreeProvider } from "./git-worktree.ts";

const setup = () => {
  const origin = createOriginRepo();
  const provider = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
  const spec = { runId: "run-1", remoteUrl: origin, baseBranch: "main", branchName: "handoff/run-1" };
  return { origin, provider, spec };
};

test("GitWorktreeProvider creates a worktree on a new branch from the default branch", async () => {
  const { provider, spec } = setup();
  const workdir = await provider.acquire(spec);
  expect(existsSync(join(workdir.path, "README.md"))).toBe(true);
  expect(git(workdir.path, "branch", "--show-current")).toBe("handoff/run-1");
  expect(workdir.baseSha).toBe(git(workdir.path, "rev-parse", "origin/main"));
});

test("a run acquired after the remote's base moved has its local base branch at origin's", async () => {
  const { origin, provider, spec } = setup();
  await provider.acquire(spec);
  landOnMain(origin, "later.txt", "x");
  const workdir = await provider.acquire({ ...spec, runId: "run-2", branchName: "handoff/run-2" });
  expect(workdir.baseSha).toBe(git(origin, "rev-parse", "main"));
  expect(git(workdir.path, "rev-parse", "main")).toBe(workdir.baseSha);
});

test("fastForward moves the worktree's local base branch to origin's too", async () => {
  const { origin, provider, spec } = setup();
  const workdir = await provider.acquire(spec);
  landOnMain(origin, "later.txt", "x");
  const moved = await provider.fastForward(spec);
  expect(moved?.to).toBe(git(origin, "rev-parse", "main"));
  expect(git(workdir.path, "rev-parse", "main")).toBe(moved?.to);
});

test("a fetch leaves the local base branch alone while a worktree has it checked out", async () => {
  const { origin, provider, spec } = setup();
  git(origin, "branch", "release", "main");
  const onRelease = await provider.acquire({ ...spec, baseBranch: "release", branchName: "release" });
  const head = git(onRelease.path, "rev-parse", "HEAD");
  landOnMain(origin, "later.txt", "x");
  git(origin, "branch", "-f", "release", "main");
  await provider.acquire({ ...spec, runId: "run-2", baseBranch: "release", branchName: "handoff/run-2" });
  expect(git(onRelease.path, "rev-parse", "HEAD")).toBe(head);
});

test("acquiring the same run twice returns the same worktree with its changes", async () => {
  const { provider, spec } = setup();
  const first = await provider.acquire(spec);
  writeFileSync(join(first.path, "new.txt"), "x");
  const second = await provider.acquire(spec);
  expect(second.path).toBe(first.path);
  expect(existsSync(join(second.path, "new.txt"))).toBe(true);
});

test("release removes the worktree and keeps the branch", async () => {
  const { provider, spec } = setup();
  const workdir = await provider.acquire(spec);
  git(workdir.path, "commit", "--allow-empty", "-qm", "work");
  await provider.release(spec);
  expect(existsSync(workdir.path)).toBe(false);
  expect(git(provider.mirrorPath(spec.remoteUrl), "branch", "--list", "handoff/run-1")).toContain("handoff/run-1");
});

test("a run that continues another starts its branch at that branch's head", async () => {
  const { provider, spec } = setup();
  const earlier = await provider.acquire(spec);
  git(earlier.path, "commit", "--allow-empty", "-qm", "earlier work");
  const head = git(earlier.path, "rev-parse", "HEAD");
  await provider.release(spec);

  const workdir = await provider.acquire({ ...spec, runId: "run-2", branchName: "handoff/run-2", startFrom: "handoff/run-1" });
  expect(git(workdir.path, "branch", "--show-current")).toBe("handoff/run-2");
  expect(git(workdir.path, "rev-parse", "HEAD")).toBe(head);
});

test("releasing a run whose clone was never made does nothing", async () => {
  const { provider, spec } = setup();
  await expect(provider.release(spec)).resolves.toBeUndefined();
});

test("GitWorktreeProvider hands the remote's git config to git through the environment", async () => {
  const origin = createOriginRepo();
  const provider = new GitWorktreeProvider({
    root: mkdtempSync(join(tmpdir(), "handoff-home-")),
    gitEnv: async () => ({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.file.allow", GIT_CONFIG_VALUE_0: "never" }),
    retryMs: 1,
  });
  await expect(provider.acquire({ runId: "run-1", remoteUrl: origin, baseBranch: "main", branchName: "handoff/run-1" })).rejects.toThrow(/not allowed/);
});

test("a mirror fetch that fails twice and then succeeds still gives the run its worktree", async () => {
  const origin = createOriginRepo();
  const root = mkdtempSync(join(tmpdir(), "handoff-home-"));
  // Another run made the clone, so this run's acquire fetches into it.
  await new GitWorktreeProvider({ root }).acquire({ runId: "run-0", remoteUrl: origin, baseBranch: "main", branchName: "handoff/run-0" });
  const flaky = flakyFetches(2);
  const provider = new GitWorktreeProvider({ root, gitEnv: async () => flaky.env, retryMs: 10 });
  const workdir = await provider.acquire({ runId: "run-1", remoteUrl: origin, baseBranch: "main", branchName: "handoff/run-1" });
  expect(flaky.tried()).toBe(3);
  expect(existsSync(join(workdir.path, "README.md"))).toBe(true);
});

test("a failed clone does not reveal the auth header", async () => {
  const provider = new GitWorktreeProvider({
    root: mkdtempSync(join(tmpdir(), "handoff-home-")),
    retryMs: 1,
    gitEnv: async () => ({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic c2VjcmV0LXRva2Vu" }),
  });
  const failure = provider.acquire({ runId: "run-1", remoteUrl: join(tmpdir(), "no-such-repo"), baseBranch: "main", branchName: "handoff/run-1" });
  await expect(failure).rejects.toThrow(/clone/);
  await expect(failure).rejects.not.toThrow(/c2VjcmV0/);
});
