import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** owner/name from a GitHub remote URL (SSH or HTTPS), or undefined for anything else. */
export function parseGitHubRemote(remote: string): string | undefined {
  const match = remote.trim().match(/^(?:git@github\.com:|(?:ssh:\/\/git@|https?:\/\/(?:[^@/]+@)?)github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** The GitHub repository a folder's git origin points at, if it has one. */
export async function repoOfFolder(folder: string | undefined): Promise<string | undefined> {
  if (!folder) return undefined;
  try {
    const { stdout } = await run("git", ["-C", folder, "remote", "get-url", "origin"], { timeout: 5000 });
    return parseGitHubRemote(stdout);
  } catch {
    return undefined;
  }
}
