import type { Db } from "@handoff/db";
import { stuckLoop } from "@handoff/engine/operations";
import { stuckRuns, waitingReviews } from "./attention";
import { listInbox } from "./inbox";

/**
 * What waits on a person, grouped by what they must do: reviews to open, questions to answer, runs
 * that stopped (failed, or stuck on a loop that ran out of rounds), and pull requests to review on
 * GitHub. A run stuck on a loop is listed only as stuck, since it needs a decision rather than a repair.
 */
export async function inboxGroups(db: Db) {
  const [inbox, reviews, stuck] = await Promise.all([listInbox(db), waitingReviews(db), stuckRuns(db)]);
  const loops = await Promise.all(stuck.map(async (s) => ({ run: s, loop: await stuckLoop(db, s.runId) })));
  const stuckRunsList = loops.flatMap(({ run, loop }) =>
    loop
      ? [{ runId: run.runId, projectId: run.projectId, projectName: run.projectName, task: run.task, nodeKey: loop.nodeKey, loop: loop.edgeKey, attempts: loop.attempts, finishedAt: run.finishedAt }]
      : [],
  );
  const stuckIds = new Set(stuckRunsList.map((s) => s.runId));
  const isReview = (q: { context: Record<string, unknown> }) => Boolean(q.context.review);
  const groups = {
    reviews: inbox.questions.filter(isReview),
    questions: inbox.questions.filter((q) => !isReview(q)),
    failedRuns: inbox.failedRuns.filter((f) => !stuckIds.has(f.runId)),
    stuckRuns: stuckRunsList,
    pullRequests: reviews.map((r) => ({
      executionId: r.executionId,
      runId: r.runId,
      projectId: r.projectId,
      projectName: r.projectName,
      task: r.task,
      branch: r.branch,
      number: r.pr!.number!,
      url: r.pr!.url ?? null,
      ci: r.pr!.ci ?? null,
    })),
  };
  const count = groups.reviews.length + groups.questions.length + groups.failedRuns.length + groups.stuckRuns.length + groups.pullRequests.length;
  return { ...groups, count };
}

export type InboxGroups = Awaited<ReturnType<typeof inboxGroups>>;
