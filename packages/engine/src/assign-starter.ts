import { appendEvents, type Db } from "@handoff/db";
import type { GitHubPort, RepoRef } from "@handoff/github";

/**
 * A run event that says what assigning a run's issue did: the token's user assigned, or skipped with
 * the reason (no-user for a GitHub App, not-assignable when GitHub kept nobody, else GitHub's message).
 */
export type AssignEvent =
  | { type: "issue.assigned"; payload: { issue: number; login: string } }
  | { type: "issue.assign.skipped"; payload: { issue: number; reason: string } };

/**
 * Assigns the token's user to each issue of a run that has no assignee, so the person who starts
 * the work is the one GitHub names. An existing assignee stays. Never throws: a failure is recorded
 * on the run as issue.assign.skipped and the run goes on. Returns the events it appended.
 */
export async function assignStarter(db: Db, runId: string, github: GitHubPort | undefined, repo: RepoRef, issues: number[]): Promise<AssignEvent[]> {
  if (!github || issues.length === 0) return [];
  const skipped = (issue: number, reason: string): AssignEvent => ({ type: "issue.assign.skipped", payload: { issue, reason } });
  const login = await github.viewer().catch(() => undefined);
  const written: AssignEvent[] = [];
  for (const issue of issues) {
    if (!login) {
      written.push(skipped(issue, "no-user"));
      continue;
    }
    try {
      if ((await github.getIssue(repo, issue)).assignees.length > 0) continue;
      const kept = await github.setAssignees(repo, issue, [login]);
      written.push(kept.includes(login) ? { type: "issue.assigned", payload: { issue, login } } : skipped(issue, "not-assignable"));
    } catch (error) {
      written.push(skipped(issue, error instanceof Error ? error.message : String(error)));
    }
  }
  if (written.length) await db.transaction((tx) => appendEvents(tx, runId, written));
  return written;
}
