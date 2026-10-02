import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ownDiffFingerprint } from "./approvals.ts";
import { createOriginRepo, git, landOnMain } from "./testing/git.ts";

const lines = (...items: string[]) => `${items.join("\n")}\n`;
const original = lines("one", "two", "three", "four", "five");

/** A clone of origin with a run branch that changed line four, as a run's worktree would be. */
function runBranch() {
  const origin = createOriginRepo({ "notes.txt": original });
  const work = mkdtempSync(join(tmpdir(), "handoff-approvals-"));
  git(work, "clone", "-q", origin, ".");
  git(work, "checkout", "-q", "-b", "run");
  writeFileSync(join(work, "notes.txt"), lines("one", "two", "three", "four, from the run", "five"));
  git(work, "commit", "-qam", "Change line four");
  return { origin, work };
}

test("the fingerprint is the same after merging a base that changed a neighbouring line", async () => {
  const { origin, work } = runBranch();
  const approved = await ownDiffFingerprint(work, "origin/main");
  expect(approved).toMatch(/^[0-9a-f]{64}$/);

  landOnMain(origin, "notes.txt", lines("one", "two", "three, from main", "four", "five"));
  git(work, "fetch", "-q", "origin");
  // Git calls the neighbouring lines a conflict; the resolution keeps both sides.
  expect(() => git(work, "merge", "-q", "--no-edit", "origin/main")).toThrow();
  writeFileSync(join(work, "notes.txt"), lines("one", "two", "three, from main", "four, from the run", "five"));
  git(work, "commit", "-qam", "Merge main");

  expect(await ownDiffFingerprint(work, "origin/main")).toBe(approved);
});

test("the fingerprint changes when the run's own lines change", async () => {
  const { work } = runBranch();
  const approved = await ownDiffFingerprint(work, "origin/main");

  writeFileSync(join(work, "notes.txt"), lines("one", "two", "three", "four, from the run, again", "five"));
  git(work, "commit", "-qam", "Change line four again");

  const changed = await ownDiffFingerprint(work, "origin/main");
  expect(changed).toMatch(/^[0-9a-f]{64}$/);
  expect(changed).not.toBe(approved);
});
