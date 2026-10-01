import type { GitHubPort, RepoRef } from "@handoff/github";
import { parseDependsOn } from "../lib/depends-on";

/**
 * Turns the "Depends on" lines in the repository's open issues into GitHub's own "blocked by" links,
 * so GitHub holds the dependencies and handoff reads them from there. Only open blockers that are not
 * linked yet are added; a closed dependency blocks nothing. Returns the links it added.
 */
export async function linkDependencies(github: GitHubPort, repo: RepoRef): Promise<{ issue: number; blocker: number }[]> {
  const issues = await github.listIssues(repo);
  const open = new Set(issues.map((i) => i.number));
  const bodies = await Promise.all(issues.map((i) => github.getIssue(repo, i.number).then((d) => d.body)));
  const links = issues.flatMap((issue, i) =>
    parseDependsOn(bodies[i]!)
      .filter((n) => n !== issue.number && open.has(n) && !issue.blockedBy.includes(n))
      .map((blocker) => ({ issue: issue.number, blocker })),
  );
  // One at a time: GitHub limits how fast content like links may be created.
  await links.reduce((previous, link) => previous.then(() => github.addBlockedBy(repo, link.issue, link.blocker)), Promise.resolve());
  return links;
}
