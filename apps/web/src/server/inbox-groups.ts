import { and, eq, inArray, isNotNull, projects, runs, type Db } from "@handoff/db";
import { stuckLoop } from "@handoff/engine/operations";
import { inboxCount } from "@/components/inbox/inbox-view";
import { stuckRuns, waitingReviews } from "./attention";
import { listInbox } from "./inbox";
import { projectMergeQueue } from "./merge-queue";
import { allPendingPermissions } from "./permissions";

/** The first pull request of each project's merge queue, when it waits for a person to merge it. */
async function readyToMerge(db: Db) {
  const queued = await db
    .selectDistinct({ projectId: runs.projectId, projectName: projects.name })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(isNotNull(runs.mergeQueuedAt), inArray(runs.status, ["queued", "running", "waiting"])));
  const firsts = await Promise.all(queued.map(async (p) => ({ ...p, first: (await projectMergeQueue(db, p.projectId))[0] })));
  return firsts.flatMap(({ projectId, projectName, first }) =>
    first && first.waiting && first.mode === "manual" && !first.requested
      ? [{ runId: first.runId, projectId, projectName, task: first.task, prNumber: first.prNumber, issues: first.issues }]
      : [],
  );
}

/**
 * What waits on a person, grouped by what they must do: reviews to open, questions to answer, runs
 * that stopped (failed, or stuck on a loop that ran out of rounds), and pull requests to review on
 * GitHub. A run stuck on a loop is listed only as stuck, since it needs a decision rather than a repair.
 * With a project id, only that project's items.
 */
export async function inboxGroups(db: Db, opts: { projectId?: string } = {}) {
  const mine = <T extends { projectId: string }>(items: T[]) => (opts.projectId ? items.filter((i) => i.projectId === opts.projectId) : items);
  const [all, allReviews, allStuck, allReady, allPermissions] = await Promise.all([listInbox(db), waitingReviews(db), stuckRuns(db), readyToMerge(db), allPendingPermissions(db)]);
  const inbox = { questions: mine(all.questions), failedRuns: mine(all.failedRuns) };
  const [reviews, stuck, ready, permissions] = [mine(allReviews), mine(allStuck), mine(allReady), mine(allPermissions)];
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
  const withReady = { ...groups, readyToMerge: ready, permissions };
  return { ...withReady, count: inboxCount(withReady) };
}

/** How many items the Inbox page shows, for the sidebar's Inbox badge. */
export async function inboxTotal(db: Db) {
  return inboxCount(await inboxGroups(db));
}

export type InboxGroups = Awaited<ReturnType<typeof inboxGroups>>;
