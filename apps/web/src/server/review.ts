import { and, eq, projects, questions, runs, type Db } from "@handoff/db";

export type ReviewContext = { from: string; kind: string; markdown: string };

/** A human gate's review question with its run, or undefined when there is none with that id on that run. */
export async function getReview(db: Db, runId: string, questionId: string) {
  const [row] = await db
    .select({ question: questions, task: runs.task, runStatus: runs.status, projectName: projects.name })
    .from(questions)
    .innerJoin(runs, eq(runs.id, questions.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(eq(questions.id, questionId), eq(questions.runId, runId)));
  if (!row) return undefined;
  const review = (row.question.context as { review?: ReviewContext }).review;
  if (!review) return undefined;
  const q = row.question;
  return {
    id: q.id,
    question: q.question,
    review,
    task: row.task,
    runStatus: row.runStatus,
    projectName: row.projectName,
    answered: q.answer === null ? null : { option: q.option, answer: q.answer, comments: q.comments, answeredBy: q.answeredBy, answeredAt: q.answeredAt },
  };
}
