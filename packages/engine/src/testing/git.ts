import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8" }).trim();

/** Lands a commit on origin's main from another clone, as another pull request merging while a run works. */
export function landOnMain(origin: string, path: string, content: string) {
  const work = mkdtempSync(join(tmpdir(), "handoff-other-"));
  git(work, "clone", "-q", origin, ".");
  mkdirSync(dirname(join(work, path)), { recursive: true });
  writeFileSync(join(work, path), content);
  git(work, "add", "-A");
  git(work, "commit", "-qm", `Change ${path} on main`);
  git(work, "push", "-q", "origin", "main");
}

/**
 * Git config, as environment, whose transport drops the first `failures` fetches from origin as a
 * flaky network would, and a count of the fetches tried.
 */
export function flakyFetches(failures: number): { env: Record<string, string>; tried(): number } {
  const dir = mkdtempSync(join(tmpdir(), "handoff-flaky-"));
  const counter = join(dir, "fetches");
  const script = join(dir, "upload-pack");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `n=$(cat '${counter}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${counter}'`,
      `if [ "$n" -le ${failures} ]; then echo "fatal: the remote end hung up unexpectedly" >&2; exit 128; fi`,
      'exec git-upload-pack "$@"',
    ].join("\n"),
    { mode: 0o755 },
  );
  return {
    env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "remote.origin.uploadpack", GIT_CONFIG_VALUE_0: script },
    tried: () => (existsSync(counter) ? Number(readFileSync(counter, "utf8").trim()) : 0),
  };
}

/** A bare "origin" repository with one commit on main. */
export function createOriginRepo(files: Record<string, string> = { "README.md": "# sample\n" }): string {
  const work = mkdtempSync(join(tmpdir(), "handoff-seed-"));
  git(work, "init", "-q", "-b", "main");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), content);
  }
  git(work, "add", "-A");
  git(work, "commit", "-qm", "initial");
  const origin = mkdtempSync(join(tmpdir(), "handoff-origin-"));
  git(origin, "clone", "-q", "--bare", work, ".");
  return origin;
}
