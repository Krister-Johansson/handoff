import { and, eq, graphVersions, nodeExecutions, projects, questions, runs, type Db } from "@handoff/db";
import type { DemoWarning } from "@handoff/core";
import type { Shot } from "../components/runs/screenshot";
import type { TryPreview } from "../components/review/try-review";

type Edge = { source: string; target: string; attributes?: { port?: string } };

/**
 * A Try it gate's question as its page shows it: the app, the run's acceptance criteria, the demo's
 * screenshots and warnings, the step that gets the work back, and the answer once there is one. Undefined for a
 * question that is not a Try it gate's.
 */
export async function getTryReview(db: Db, runId: string, questionId: string) {
  const [row] = await db
    .select({ question: questions, task: runs.task, projectId: projects.id, projectName: projects.name, nodeKey: nodeExecutions.nodeKey, document: graphVersions.document })
    .from(questions)
    .innerJoin(runs, eq(runs.id, questions.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .innerJoin(nodeExecutions, eq(nodeExecutions.id, questions.nodeExecutionId))
    .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
    .where(and(eq(questions.id, questionId), eq(questions.runId, runId)));
  const context = row?.question.context as { reason?: string; acceptance?: string[]; preview?: TryPreview; shots?: Shot[]; warnings?: DemoWarning[] } | undefined;
  if (!row || context?.reason !== "try") return undefined;
  const edges = (row.document as { edges?: Edge[] }).edges ?? [];
  const backTo = edges.find((e) => e.source === row.nodeKey && e.attributes?.port === "changes")?.target ?? "the coder";
  const q = row.question;
  return {
    id: q.id,
    question: q.question,
    task: row.task,
    projectId: row.projectId,
    projectName: row.projectName,
    nodeKey: row.nodeKey,
    backTo,
    acceptance: context.acceptance ?? [],
    preview: context.preview ?? ({ status: "failed", error: "The app has not started yet." } satisfies TryPreview),
    shots: context.shots ?? [],
    warnings: context.warnings ?? [],
    answered: q.answer === null ? null : { option: q.option, comments: q.comments },
  };
}
