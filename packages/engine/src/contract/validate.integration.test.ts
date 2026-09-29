import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { initialRunState } from "@handoff/core";
import { createOriginRepo, git } from "../testing/git.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { validateContract } from "./validate.ts";

async function worktree() {
  const provider = new GitWorktreeProvider({ root: mkdtempSync(join(tmpdir(), "handoff-home-")) });
  const w = await provider.acquire({ runId: "r", remoteUrl: createOriginRepo(), baseBranch: "main", branchName: "handoff/r" });
  return w.path;
}

const coderDone = { status: "done", summary: "ok" };

test("validateContract rejects output that fails the contract schema", async () => {
  const result = await validateContract({ output: "coder_output", checks: [] }, { status: "sure" }, {
    state: initialRunState("t"),
    baseBranch: "main",
  });
  expect(result.passed).toBe(false);
  expect(result.issues?.length).toBeGreaterThan(0);
});

test("validateContract fails when the node reports status failed", async () => {
  const result = await validateContract({ output: "coder_output", checks: [] }, { status: "failed", summary: "gave up" }, {
    state: initialRunState("t"),
    baseBranch: "main",
  });
  expect(result.passed).toBe(false);
  expect(result.reason).toMatch(/reported failed/);
});

test("needs_input passes the contract without running checks", async () => {
  const result = await validateContract(
    { output: "coder_output", checks: [{ kind: "tests_green", command: "exit 1", timeoutMs: 5000 }] },
    { status: "needs_input", summary: "?", question: { text: "Which date format?" } },
    { state: initialRunState("t"), baseBranch: "main", workdir: "/nonexistent" },
  );
  expect(result.passed).toBe(true);
  expect(result.checks).toEqual([]);
});

test("diff_within_paths fails when the diff touches a path outside owned paths", async () => {
  const dir = await worktree();
  writeFileSync(join(dir, "allowed.md"), "ok");
  writeFileSync(join(dir, "secret.env"), "no");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "change");
  const state = { ...initialRunState("t"), plan: { plan: "p", steps: [], ownedPaths: ["allowed.md", "docs/**"] } };
  const result = await validateContract({ output: "coder_output", checks: [{ kind: "diff_within_paths" }] }, coderDone, {
    state,
    baseBranch: "main",
    workdir: dir,
  });
  expect(result.passed).toBe(false);
  expect(result.checks[0]).toMatchObject({ kind: "diff_within_paths", passed: false });
  expect(result.checks[0]?.detail).toContain("secret.env");
});

test("diff_within_paths passes when every changed file is owned, including uncommitted ones", async () => {
  const dir = await worktree();
  writeFileSync(join(dir, "allowed.md"), "ok");
  const state = { ...initialRunState("t"), plan: { plan: "p", steps: [], ownedPaths: ["allowed.md"] } };
  const result = await validateContract({ output: "coder_output", checks: [{ kind: "diff_within_paths" }] }, coderDone, {
    state,
    baseBranch: "main",
    workdir: dir,
  });
  expect(result.passed).toBe(true);
});

test("tests_green runs the command in the workdir and passes on exit 0", async () => {
  const dir = await worktree();
  const ok = await validateContract({ output: "coder_output", checks: [{ kind: "tests_green", command: "test -f README.md", timeoutMs: 5000 }] }, coderDone, {
    state: initialRunState("t"),
    baseBranch: "main",
    workdir: dir,
  });
  expect(ok.passed).toBe(true);
  const bad = await validateContract(
    { output: "coder_output", checks: [{ kind: "tests_green", command: "echo failing-test >&2; exit 3", timeoutMs: 5000 }] },
    coderDone,
    { state: initialRunState("t"), baseBranch: "main", workdir: dir },
  );
  expect(bad.passed).toBe(false);
  expect(bad.checks[0]).toMatchObject({ kind: "tests_green", passed: false });
  expect(bad.checks[0]?.logTail).toContain("failing-test");
});

test("no_uncommitted_changes fails on a dirty worktree", async () => {
  const dir = await worktree();
  writeFileSync(join(dir, "dirty.txt"), "x");
  const result = await validateContract({ output: "coder_output", checks: [{ kind: "no_uncommitted_changes" }] }, coderDone, {
    state: initialRunState("t"),
    baseBranch: "main",
    workdir: dir,
  });
  expect(result.passed).toBe(false);
});
