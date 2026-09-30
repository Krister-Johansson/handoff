import { projects, type Db } from "@handoff/db";
import type { GitHubPort, RepoSummary } from "@handoff/github";

export type AvailableRepo = RepoSummary & { project: string | null };

const cache = new WeakMap<GitHubPort, { at: number; repos: Promise<RepoSummary[]> }>();

/** The credential's repositories, fetched from GitHub at most once per `maxAgeMs`. */
function cachedRepos(github: GitHubPort, maxAgeMs: number): Promise<RepoSummary[]> {
  const hit = cache.get(github);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.repos;
  const repos = github.listRepos();
  cache.set(github, { at: Date.now(), repos });
  repos.catch(() => cache.delete(github));
  return repos;
}

/** Repositories the GitHub credential can reach, each with the name of the project that already uses it. */
export async function listAvailableRepos(db: Db, github: GitHubPort, opts: { maxAgeMs?: number } = {}): Promise<AvailableRepo[]> {
  const [repos, existing] = await Promise.all([
    cachedRepos(github, opts.maxAgeMs ?? 0),
    db.select({ name: projects.name, owner: projects.repoOwner, repo: projects.repoName }).from(projects),
  ]);
  const byRepo = new Map(existing.map((p) => [`${p.owner}/${p.repo}`.toLowerCase(), p.name]));
  return repos.map((r) => ({ ...r, project: byRepo.get(r.fullName.toLowerCase()) ?? null }));
}
