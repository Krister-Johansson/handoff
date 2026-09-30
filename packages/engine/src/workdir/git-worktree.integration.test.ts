import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createOriginRepo, git } from "../testing/git.ts";
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

test("GitWorktreeProvider hands the remote's git config to git through the environment", async () => {
  const origin = createOriginRepo();
  const provider = new GitWorktreeProvider({
    root: mkdtempSync(join(tmpdir(), "handoff-home-")),
    gitEnv: async () => ({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.file.allow", GIT_CONFIG_VALUE_0: "never" }),
  });
  await expect(provider.acquire({ runId: "run-1", remoteUrl: origin, baseBranch: "main", branchName: "handoff/run-1" })).rejects.toThrow(/not allowed/);
});

test("a failed clone does not reveal the auth header", async () => {
  const provider = new GitWorktreeProvider({
    root: mkdtempSync(join(tmpdir(), "handoff-home-")),
    gitEnv: async () => ({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic c2VjcmV0LXRva2Vu" }),
  });
  const failure = provider.acquire({ runId: "run-1", remoteUrl: join(tmpdir(), "no-such-repo"), baseBranch: "main", branchName: "handoff/run-1" });
  await expect(failure).rejects.toThrow(/clone/);
  await expect(failure).rejects.not.toThrow(/c2VjcmV0/);
});
