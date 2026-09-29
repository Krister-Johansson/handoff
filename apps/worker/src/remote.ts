/** Owner and name from a GitHub https or ssh remote; undefined for anything else (local paths in tests). */
export function parseGitHubRemote(remote: string): { owner: string; name: string } | undefined {
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote);
  return match ? { owner: match[1]!, name: match[2]! } : undefined;
}
