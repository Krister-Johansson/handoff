import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { branchDiff } from "./branch-diff.ts";

const root = mkdtempSync(join(tmpdir(), "branch-diff-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

/** An origin with main, and a clone whose branch changes one file and adds another. */
function repo() {
  const origin = join(root, "origin");
  git(root, "init", "-q", "-b", "main", origin);
  writeFileSync(join(origin, "a.ts"), "one\ntwo\nthree\n");
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", "base");
  const clone = join(root, "clone");
  git(root, "clone", "-q", origin, clone);
  git(clone, "checkout", "-q", "-b", "feature");
  writeFileSync(join(clone, "a.ts"), "one\nTWO\nthree\n");
  writeFileSync(join(clone, "b.ts"), "export {};\n");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "change");
  return clone;
}

test("branchDiff returns the branch's changes against origin's base branch, with whole files", async () => {
  const clone = repo();
  const files = await branchDiff({ worktreePath: clone, baseBranch: "main" } as never);
  expect(files?.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
    ["a.ts", "modified", 1, 1],
    ["b.ts", "added", 1, 0],
  ]);
  expect(files?.[0]!.hunks[0]!.lines.map((l) => l.text)).toEqual(["one", "two", "TWO", "three"]);
  expect(files?.[0]!.blob).toMatch(/^[0-9a-f]{40}$/);
});

test("branchDiff has nothing without a worktree, and nothing when git fails", async () => {
  expect(await branchDiff({ worktreePath: null, baseBranch: "main" } as never)).toBeUndefined();
  expect(await branchDiff({ worktreePath: join(root, "missing"), baseBranch: "main" } as never)).toBeUndefined();
});
