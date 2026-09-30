import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The worker pins the Claude CLI version: the docs say --bare will become the default for -p, and
 * bare mode ignores the subscription login. A version bump is a deliberate, reviewed change.
 */
export async function checkClaudeVersion(
  bin: string,
  expected: string,
  allowDrift: boolean,
  docker?: { image: string; mounts: string[] },
): Promise<{ version: string; drift?: true }> {
  const { stdout } = docker
    ? await run("docker", ["run", "--rm", ...docker.mounts.flatMap((m) => ["-v", `${m}:${m}`]), docker.image, bin, "--version"])
    : await run(bin, ["--version"]);
  const version = stdout.trim().split(/\s+/)[0] ?? "";
  if (version === expected) return { version };
  if (allowDrift) return { version, drift: true };
  throw new Error(
    `claude ${version} does not match HANDOFF_CLAUDE_VERSION ${expected}. Check the CLI changelog for changes to -p and --bare, then update the pin, or set HANDOFF_ALLOW_CLI_DRIFT=1.`,
  );
}
