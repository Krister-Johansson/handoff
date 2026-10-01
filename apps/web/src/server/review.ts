import type { DiffFile } from "@handoff/core";
import { and, asc, eq, isNotNull, lt, nodeExecutions, projects, questions, reviewViews, runs, sql, type Db } from "@handoff/db";

/** What the gate showed for review; a code review also carries the branch's changed files. */
export type ReviewContext = { from: string; kind: string; markdown: string; files?: DiffFile[]; backTo?: string };

/** The answered questions from this gate's earlier rounds in the same run, oldest first. */
async function earlierRounds(db: Db, question: typeof questions.$inferSelect) {
  const [execution] = await db.select({ nodeKey: nodeExecutions.nodeKey }).from(nodeExecutions).where(eq(nodeExecutions.id, question.nodeExecutionId));
  if (!execution) return [];
  return db
    .select({ answer: questions.answer, option: questions.option, comments: questions.comments, answeredAt: questions.answeredAt })
    .from(questions)
    .innerJoin(nodeExecutions, eq(nodeExecutions.id, questions.nodeExecutionId))
    .where(and(eq(questions.runId, question.runId), eq(nodeExecutions.nodeKey, execution.nodeKey), isNotNull(questions.answer), lt(questions.createdAt, question.createdAt)))
    .orderBy(asc(questions.createdAt));
}

/** A human gate's review question with its run, or undefined when there is none with that id on that run. */
export async function getReview(db: Db, runId: string, questionId: string) {
  const [row] = await db
    .select({ question: questions, task: runs.task, runStatus: runs.status, projectName: projects.name, projectId: projects.id })
    .from(questions)
    .innerJoin(runs, eq(runs.id, questions.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(eq(questions.id, questionId), eq(questions.runId, runId)));
  if (!row) return undefined;
  const review = (row.question.context as { review?: ReviewContext }).review;
  if (!review) return undefined;
  const q = row.question;
  const [views, earlier] = await Promise.all([
    db.select({ path: reviewViews.path, blobSha: reviewViews.blobSha, viewedAt: reviewViews.viewedAt }).from(reviewViews).where(eq(reviewViews.runId, runId)),
    earlierRounds(db, q),
  ]);
  return {
    id: q.id,
    question: q.question,
    review,
    task: row.task,
    runStatus: row.runStatus,
    projectName: row.projectName,
    projectId: row.projectId,
    answered: q.answer === null ? null : { option: q.option, answer: q.answer, comments: q.comments, answeredBy: q.answeredBy, answeredAt: q.answeredAt },
    views,
    earlier: earlier.map((e) => ({ answer: e.answer!, option: e.option, comments: e.comments, answeredAt: e.answeredAt })),
  };
}

/** Marks or unmarks a version of a file as viewed in a run's code review; marking again moves the time forward. */
export async function markViewed(db: Db, input: { runId: string; path: string; blobSha: string; viewed: boolean }) {
  const match = and(eq(reviewViews.runId, input.runId), eq(reviewViews.path, input.path), eq(reviewViews.blobSha, input.blobSha));
  if (!input.viewed) {
    await db.delete(reviewViews).where(match);
    return;
  }
  await db
    .insert(reviewViews)
    .values({ runId: input.runId, path: input.path, blobSha: input.blobSha })
    .onConflictDoUpdate({ target: [reviewViews.runId, reviewViews.path, reviewViews.blobSha], set: { viewedAt: sql`now()` } });
}
