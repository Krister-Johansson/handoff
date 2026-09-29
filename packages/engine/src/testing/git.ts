import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8" }).trim();

/** A bare "origin" repository with one commit on main. */
export function createOriginRepo(files: Record<string, string> = { "README.md": "# sample\n" }): string {
  const work = mkdtempSync(join(tmpdir(), "handoff-seed-"));
  git(work, "init", "-q", "-b", "main");
  for (const [path, content] of Object.entries(files)) writeFileSync(join(work, path), content);
  git(work, "add", "-A");
  git(work, "commit", "-qm", "initial");
  const origin = mkdtempSync(join(tmpdir(), "handoff-origin-"));
  git(origin, "clone", "-q", "--bare", work, ".");
  return origin;
}
