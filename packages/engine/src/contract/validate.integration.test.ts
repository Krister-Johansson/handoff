import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { initialRunState } from "@handoff/core";
import { itemsToAnswer } from "../review-answers.ts";
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

test("diff_within_paths accepts files the coder listed as extra paths with a reason, and no others", async () => {
  const dir = await worktree();
  writeFileSync(join(dir, "allowed.md"), "ok");
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "allowBuilds: {}");
  writeFileSync(join(dir, "secret.env"), "no");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "change");
  const state = { ...initialRunState("t"), plan: { plan: "p", steps: [], ownedPaths: ["allowed.md"] } };
  const output = { ...coderDone, extraPaths: [{ path: "pnpm-workspace.yaml", reason: "pnpm 12 reads build approvals only from this file" }] };
  const result = await validateContract({ output: "coder_output", checks: [{ kind: "diff_within_paths" }] }, output, { state, baseBranch: "main", workdir: dir });
  expect(result.passed).toBe(false);
  expect(result.checks[0]?.detail).toContain("secret.env");
  expect(result.checks[0]?.detail).not.toContain("pnpm-workspace.yaml");
  git(dir, "rm", "-q", "secret.env");
  git(dir, "commit", "-qm", "drop");
  const clean = await validateContract({ output: "coder_output", checks: [{ kind: "diff_within_paths" }] }, output, { state, baseBranch: "main", workdir: dir });
  expect(clean.passed).toBe(true);
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

type SentKind = "thread" | "review_body" | "summary_note" | "pre_merge_check";

/** Run state after a PR step sent the coder review items from the PR at `headSha`, threads unless `kinds` says otherwise. */
function sentItems(headSha: string, handles: string[], kinds: Record<string, SentKind> = {}) {
  const comments = handles.map((item, i) => ({ author: "coderabbitai", body: `Comment ${i + 1}.`, url: `https://github.com/o/r/pull/7#discussion_r${i}`, resolved: false, item, kind: kinds[item] ?? "thread" }));
  const feedback = { ci: { status: "success" as const, failedJobs: [] }, review: { decision: "changes_requested" as const, comments, unresolvedThreads: comments.length }, updatedAt: "2026-10-05T16:17:28Z" };
  const output = { sync: "clean", prNumber: 7, prUrl: "https://github.com/o/r/pull/7", headSha, feedback };
  return { ...initialRunState("t"), prNumber: 7, nodes: { pr: { output, executionId: "pr-2", attempt: 2 } } };
}

const declined = (id: string) => ({ id, verdict: "declined", evidence: "`pnpm test` passes with the integration project; see vitest.config.ts:12." });

test("a coder sent three items that answers two fails review_items_answered naming the third", async () => {
  const dir = await worktree();
  const state = sentItems(git(dir, "rev-parse", "HEAD"), ["R1", "R2", "R3"]);
  const output = { ...coderDone, answers: [declined("R1"), declined("R2")] };
  const result = await validateContract({ output: "coder_output", checks: [] }, output, { state, baseBranch: "main", workdir: dir, reviewRound: itemsToAnswer(state, ["pr"]) });
  expect(result.passed).toBe(false);
  expect(result.reason).toContain("review_items_answered");
  const check = result.checks.find((c) => c.kind === "review_items_answered");
  expect(check?.passed).toBe(false);
  expect(check?.detail).toContain("R3 has no answer");
  expect(check?.detail).not.toContain("R1");

  const all = { ...coderDone, answers: [declined("R1"), declined("R2"), declined("R3")] };
  const passed = await validateContract({ output: "coder_output", checks: [] }, all, { state, baseBranch: "main", workdir: dir, reviewRound: itemsToAnswer(state, ["pr"]) });
  expect(passed.passed).toBe(true);
  expect(passed.checks.map((c) => c.kind)).toEqual(["review_items_answered"]);
});

test("a fixed answer whose commit was on the branch before the round fails", async () => {
  const dir = await worktree();
  writeFileSync(join(dir, "a.md"), "before the round");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "earlier work");
  const earlier = git(dir, "rev-parse", "HEAD");
  const state = sentItems(earlier, ["R1"]);
  const reviewRound = itemsToAnswer(state, ["pr"]);
  const stale = await validateContract({ output: "coder_output", checks: [] }, { ...coderDone, answers: [{ id: "R1", verdict: "fixed", evidence: "Renamed.", commit: earlier.slice(0, 7) }] }, { state, baseBranch: "main", workdir: dir, reviewRound });
  expect(stale.passed).toBe(false);
  expect(stale.checks[0]?.detail).toContain(`R1: commit ${earlier.slice(0, 7)} was on the branch before this round`);

  writeFileSync(join(dir, "a.md"), "the fix");
  git(dir, "commit", "-qam", "fix R1");
  const fix = git(dir, "rev-parse", "--short", "HEAD");
  const fixed = await validateContract({ output: "coder_output", checks: [] }, { ...coderDone, answers: [{ id: "R1", verdict: "fixed", evidence: "Renamed.", commit: fix }] }, { state, baseBranch: "main", workdir: dir, reviewRound });
  expect(fixed.passed).toBe(true);
});

test("a summary note or pre-merge check is fixed without a commit when the evidence says what changed; a thread is not", async () => {
  const dir = await worktree();
  const state = sentItems(git(dir, "rev-parse", "HEAD"), ["R1", "R2", "R3", "R4"], { R2: "pre_merge_check", R3: "summary_note", R4: "review_body" });
  const reviewRound = itemsToAnswer(state, ["pr"]);
  const title = { verdict: "fixed", evidence: 'The PR title is now "Add create_task to the tool catalog".' };
  const answers = [
    { id: "R1", ...title },
    { id: "R2", ...title },
    { id: "R3", verdict: "fixed", evidence: "The PR description now names the three tools." },
    { id: "R4", ...title },
  ];
  const result = await validateContract({ output: "coder_output", checks: [] }, { ...coderDone, answers }, { state, baseBranch: "main", workdir: dir, reviewRound });
  expect(result.passed).toBe(false);
  expect(result.checks[0]?.detail).toBe("R1: fixed needs the commit that fixes it; R4: fixed needs the commit that fixes it");

  const blank = await validateContract(
    { output: "coder_output", checks: [] },
    { ...coderDone, answers: [declined("R1"), { id: "R2", verdict: "fixed", evidence: " " }, declined("R3"), declined("R4")] },
    { state, baseBranch: "main", workdir: dir, reviewRound },
  );
  expect(blank.checks[0]?.detail).toBe("R2: fixed needs the commit that fixes it, or evidence that says what changed");

  const fine = await validateContract(
    { output: "coder_output", checks: [] },
    { ...coderDone, answers: [declined("R1"), answers[1], answers[2], declined("R4")] },
    { state, baseBranch: "main", workdir: dir, reviewRound },
  );
  expect(fine.passed).toBe(true);
});

test("a coder attempt the tester sent back needs no answers", async () => {
  const dir = await worktree();
  const sent = sentItems(git(dir, "rev-parse", "HEAD"), ["R1", "R2"]);
  // The coder answered both in its first attempt of the round, then the tester sent its fix back.
  const state = {
    ...sent,
    reviewAnswers: { R1: { ...declined("R1"), round: "pr-2" }, R2: { ...declined("R2"), round: "pr-2" } },
    nodes: { ...sent.nodes, tester: { output: { passed: false, command: "pnpm test", exitCode: 1, tail: "1 failed" }, executionId: "tester-2", attempt: 2 } },
  };
  const reviewRound = itemsToAnswer(state, ["pr"]);
  expect(reviewRound).toBeUndefined();
  const result = await validateContract({ output: "coder_output", checks: [] }, coderDone, { state, baseBranch: "main", workdir: dir, reviewRound });
  expect(result.passed).toBe(true);
  expect(result.checks).toEqual([]);
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
