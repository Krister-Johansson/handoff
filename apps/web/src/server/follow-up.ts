import { appendEvents, eq, projects, runs, type Db } from "@handoff/db";
import type { GitHubPort, ProjectsPort } from "@handoff/github";
import type { Finding, FollowUp } from "@/lib/findings";
import { getReview } from "./review.ts";

/** What opening a follow-up issue needs: the database, GitHub for a plain issue, and the plan for a sub-issue. */
export type FollowUpDeps = { db: Db; github: GitHubPort | undefined; projects: ProjectsPort | undefined };

const SEVERITY_NAMES: Record<string, string> = { blocking: "blocking", should_fix: "should fix", follow_up: "follow-up" };

/** A finding as a section of the issue body: where it is, how much it matters, and its text. */
const sectionOf = (f: Finding) => `### \`${f.line !== undefined ? `${f.path}:${f.line}` : f.path}\` (${SEVERITY_NAMES[f.severity ?? "should_fix"]})\n\n${f.body.trim()}`;

const TITLE_CHARS = 200;
const cut = (text: string) => (text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1)}…` : text);

/**
 * Opens one GitHub issue with the code review findings a person picked at a code review gate, by
 * their place in the review. With a plan on GitHub Projects it is a sub-issue of the run's issue in
 * Shaping; without one it is a plain issue that names the run's issue. Records `review.follow_up` on
 * the run, and refuses a second issue for the same question.
 */
export async function createFollowUp(deps: FollowUpDeps, input: { runId: string; questionId: string; findings: number[] }): Promise<FollowUp> {
  const review = await getReview(deps.db, input.runId, input.questionId);
  if (!review?.findings) throw new Error("This review has no code review findings.");
  if (review.followUp) throw new Error(`Follow-up issue #${review.followUp.number} was already opened from this review.`);
  const picked = [...new Set(input.findings)].sort((a, b) => a - b).flatMap((i) => (review.findings!.comments[i] ? [review.findings!.comments[i]!] : []));
  if (picked.length === 0) throw new Error("Pick at least one finding.");

  const [row] = await deps.db
    .select({ issues: runs.issues, task: runs.task, owner: projects.repoOwner, name: projects.repoName, planNumber: projects.planProjectNumber })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(eq(runs.id, input.runId));
  if (!row) throw new Error("Run not found.");
  const repo = { owner: row.owner, name: row.name };
  const issue = row.issues[0];
  const title = cut(issue ? `Follow-up to #${issue.number}: ${issue.title}` : `Follow-up: ${row.task.split("\n")[0]!.trim()}`);
  const body = [
    `Findings from handoff's code review of ${issue ? `#${issue.number}` : "this run"} that were left for later.`,
    ...picked.map(sectionOf),
  ].join("\n\n");

  let created: FollowUp;
  if (row.planNumber !== null && deps.projects) {
    created = await deps.projects.createIssue(repo, { project: row.planNumber, title, body, labels: [], ...(issue ? { parent: issue.number } : {}) });
  } else {
    if (!deps.github) throw new Error("handoff has no GitHub credentials to open an issue with.");
    created = await deps.github.createIssue(repo, { title, body: issue ? `${body}\n\nFollow-up to #${issue.number}.` : body });
  }
  await deps.db.transaction((tx) =>
    appendEvents(tx, input.runId, [{ type: "review.follow_up", payload: { questionId: input.questionId, number: created.number, url: created.url, findings: input.findings } }]),
  );
  return { number: created.number, url: created.url };
}
