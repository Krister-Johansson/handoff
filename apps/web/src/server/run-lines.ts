import { describePermission, GraphDocumentSchema } from "@handoff/core";
import { and, asc, desc, eq, graphs, graphVersions, inArray, isNull, nodeExecutions, permissionWaits, questions, runs, type DbExecutor } from "@handoff/db";
import type { RunWaitingOn } from "../components/runs/status-badge";
import { reviewPath } from "../lib/paths";
import { describeNow } from "../lib/run-now";
import type { StatusTone } from "../lib/status";

/** What a run list shows under and beside a run: its graph version, its estimated cost and what it is doing now. */
export type RunLine = {
  graph: string;
  version: number;
  /** The sum of what the Claude CLI reported for the run's steps, an estimate at list price. */
  costUsd: number;
  now: { tone: StatusTone; text: string };
  /** The review page, when the run waits for one. */
  reviewHref?: string;
  /** The steps so far in the order they first ran, each once with its latest status and how often it ran. */
  steps: RunStep[];
  /** When the current step began, while one is running, waiting or queued. */
  stepSince: Date | null;
  /** The step that waits on a person to allow a tool call, while one does; the run's status stays running. */
  waitingOn?: RunWaitingOn;
};

export type RunStep = { nodeKey: string; status: string; times: number };

/** Each step once, in the order it first ran, with its latest status and how many times it ran. */
function stepsSoFar(executions: { nodeKey: string; status: string }[]): RunStep[] {
  const steps = new Map<string, RunStep>();
  for (const e of executions) {
    const seen = steps.get(e.nodeKey);
    steps.set(e.nodeKey, { nodeKey: e.nodeKey, status: e.status, times: (seen?.times ?? 0) + 1 });
  }
  return [...steps.values()];
}

const IN_PROGRESS = new Set(["running", "waiting", "pending"]);

/** Node labels by key from a graph document. */
function nodeLabels(document: unknown): Record<string, string> {
  const parsed = GraphDocumentSchema.safeParse(document);
  if (!parsed.success) return {};
  return Object.fromEntries(parsed.data.nodes.map((n) => [n.key, n.attributes.label ?? n.key]));
}

/** A line for each of the runs, keyed by run id. */
export async function runLines(db: DbExecutor, runIds: string[]): Promise<Map<string, RunLine>> {
  const lines = new Map<string, RunLine>();
  if (runIds.length === 0) return lines;
  const [rows, executions, open, waits] = await Promise.all([
    db
      .select({
        id: runs.id,
        projectId: runs.projectId,
        status: runs.status,
        prNumber: runs.prNumber,
        versionId: graphVersions.id,
        version: graphVersions.version,
        graph: graphs.name,
      })
      .from(runs)
      .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(inArray(runs.id, runIds)),
    db
      .select({
        runId: nodeExecutions.runId,
        nodeKey: nodeExecutions.nodeKey,
        attempt: nodeExecutions.attempt,
        status: nodeExecutions.status,
        error: nodeExecutions.error,
        costUsd: nodeExecutions.costUsd,
        startedAt: nodeExecutions.startedAt,
        createdAt: nodeExecutions.createdAt,
      })
      .from(nodeExecutions)
      .where(inArray(nodeExecutions.runId, runIds))
      .orderBy(asc(nodeExecutions.createdAt)),
    db
      .select({ id: questions.id, runId: questions.runId, context: questions.context })
      .from(questions)
      .where(and(inArray(questions.runId, runIds), isNull(questions.answer)))
      .orderBy(asc(questions.createdAt)),
    permissionWaits(db, runIds),
  ]);
  const versionIds = [...new Set(rows.map((r) => r.versionId))];
  const documents = await db.select({ id: graphVersions.id, document: graphVersions.document }).from(graphVersions).where(inArray(graphVersions.id, versionIds));
  const labels = new Map(documents.map((d) => [d.id, nodeLabels(d.document)]));
  for (const run of rows) {
    const steps = executions.filter((e) => e.runId === run.id);
    const asked = open.filter((q) => q.runId === run.id);
    const review = asked.find((q) => (q.context as { review?: unknown }).review);
    const current = IN_PROGRESS.has(run.status) ? steps.findLast((e) => IN_PROGRESS.has(e.status)) : undefined;
    const wait = waits.get(run.id);
    lines.set(run.id, {
      steps: stepsSoFar(steps),
      stepSince: current ? (current.startedAt ?? current.createdAt) : null,
      graph: run.graph,
      version: run.version,
      costUsd: steps.reduce((sum, e) => sum + Number(e.costUsd ?? 0), 0),
      now: describeNow({
        status: run.status,
        executions: steps.map((e) => ({
          nodeKey: e.nodeKey,
          attempt: e.attempt,
          status: e.status,
          error: e.error ? [e.error.code, e.error.message].filter(Boolean).join(": ") : undefined,
        })),
        labels: labels.get(run.versionId) ?? {},
        prNumber: run.prNumber,
        questions: asked.length,
        reviews: review ? 1 : 0,
        permissions: wait ? [{ nodeKey: wait.nodeKey, action: describePermission(wait.toolName, wait.input).action }] : [],
      }),
      ...(review ? { reviewHref: reviewPath(run.projectId, run.id, review.id) } : {}),
      ...(wait ? { waitingOn: { kind: wait.kind, nodeKey: wait.nodeKey, since: wait.since } } : {}),
    });
  }
  return lines;
}

/** Each project's newest run, keyed by project id. */
export async function latestRuns(db: DbExecutor) {
  const rows = await db
    .selectDistinctOn([runs.projectId], { projectId: runs.projectId, id: runs.id, task: runs.task, status: runs.status, createdAt: runs.createdAt })
    .from(runs)
    .orderBy(runs.projectId, desc(runs.createdAt));
  return new Map(rows.map(({ projectId, ...run }) => [projectId, run]));
}
