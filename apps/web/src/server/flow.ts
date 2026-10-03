import { compileGraph, stepProgress, type CompiledGraph } from "@handoff/core";
import { and, asc, eq, graphVersions, inArray, isNull, nodeExecutions, permissionRequests, planPins, projectSchedulers, questions, runs, type Db } from "@handoff/db";
import { issueRuns, projectHolds, releasedRuns } from "@handoff/engine/backlog-scheduler";
import type { PlanItem, PlanSize } from "@handoff/github";
import type { Forecasts } from "../lib/plan/forecast";
import type { FlowInput, FlowRun } from "../lib/plan/flow";
import { holdText } from "../lib/scheduler-text";
import { loadForecasts } from "./forecasts";

/** The plan as the caller already read it from GitHub. */
export type FlowRead = {
  items: PlanItem[];
  priorityOptions: string[] | undefined;
  /** What each size usually takes; read from the project's runs when left out. */
  forecasts?: Forecasts | undefined;
};

const ACTIVE = ["queued", "running", "waiting"] as const;
const SIZES: readonly PlanSize[] = ["S", "M", "L"];

/** What an active run waits for, in the Flow's words; undefined while it works. */
function waitsOnOf(run: { status: string; prNumber: number | null }, asks: { permission: boolean; review: boolean; question: boolean }): string | undefined {
  if (asks.permission) return "Waits on you: permission";
  if (asks.review) return "Waits on you: review";
  if (asks.question) return "Waits on you: answer";
  if (run.status === "waiting" && run.prNumber !== null) return "Waits for checks and merge";
  return undefined;
}

/** Graph versions never change, so each compiles once per process. */
const compiled = new Map<string, CompiledGraph | null>();

function compiledGraph(versionId: string, document: unknown): CompiledGraph | null {
  if (!compiled.has(versionId)) {
    const result = compileGraph(document);
    compiled.set(versionId, result.ok ? result.graph : null);
  }
  return compiled.get(versionId)!;
}

/**
 * Each active run of the project, oldest first, with its graph steps done of the graph's steps and what it
 * waits for. A run takes the row of its first issue that is a task of the plan, else of its first issue; a
 * run started from a task text alone has no row and is left out.
 */
async function flowRuns(db: Db, projectId: string, tasks: ReadonlySet<number>): Promise<FlowRun[]> {
  const active = await db
    .select({ id: runs.id, status: runs.status, prNumber: runs.prNumber, issues: runs.issues, createdAt: runs.createdAt, versionId: runs.graphVersionId })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), inArray(runs.status, [...ACTIVE])))
    .orderBy(asc(runs.createdAt));
  if (active.length === 0) return [];
  const ids = active.map((r) => r.id);
  const versionIds = [...new Set(active.map((r) => r.versionId))];
  const [executions, open, asking, documents] = await Promise.all([
    db
      .select({ runId: nodeExecutions.runId, nodeKey: nodeExecutions.nodeKey, status: nodeExecutions.status, createdAt: nodeExecutions.createdAt })
      .from(nodeExecutions)
      .where(inArray(nodeExecutions.runId, ids))
      .orderBy(asc(nodeExecutions.createdAt), asc(nodeExecutions.id)),
    db.select({ runId: questions.runId, context: questions.context }).from(questions).where(and(inArray(questions.runId, ids), isNull(questions.answer))),
    db.select({ runId: permissionRequests.runId }).from(permissionRequests).where(and(inArray(permissionRequests.runId, ids), eq(permissionRequests.status, "pending"))),
    db.select({ id: graphVersions.id, document: graphVersions.document }).from(graphVersions).where(inArray(graphVersions.id, versionIds)),
  ]);
  const graphs = new Map(documents.map((d) => [d.id, compiledGraph(d.id, d.document)]));
  return active.flatMap((run): FlowRun[] => {
    const issue = (run.issues.find((i) => tasks.has(i.number)) ?? run.issues[0])?.number;
    if (issue === undefined) return [];
    const graph = graphs.get(run.versionId);
    const asked = open.filter((q) => q.runId === run.id);
    const asks = {
      permission: asking.some((p) => p.runId === run.id),
      review: asked.some((q) => (q.context as { review?: unknown }).review),
      question: asked.length > 0,
    };
    return [
      {
        issue,
        runId: run.id,
        createdAt: run.createdAt,
        progress: graph ? stepProgress(graph, executions.filter((e) => e.runId === run.id)) : { done: 0, total: 0 },
        waitsOn: waitsOnOf(run, asks),
      },
    ];
  });
}

/**
 * What the Flow lays out for a project (docs/plans/flow.md, Decision 5): the plan's items, the active runs
 * with their steps and what they wait for, one lane per run the scheduler may hold at once (its max_runs, or
 * 1 without a scheduler), its order and skip label, the latest run of each issue, released runs, why the
 * scheduler is held while it is on, the pins of open tasks, and each size's forecast in minutes.
 */
export async function loadFlow(db: Db, projectId: string, read: FlowRead): Promise<FlowInput> {
  const openTasks = new Set(read.items.filter((i) => i.kind === "task" && i.state === "open").map((i) => i.number));
  const byNumber = new Map(read.items.map((i) => [i.number, i]));
  const [[scheduler], holds, active, latest, released, pins, forecasts] = await Promise.all([
    db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)),
    projectHolds(db, projectId),
    flowRuns(db, projectId, openTasks),
    issueRuns(db, projectId),
    releasedRuns(db, projectId),
    db.select({ issue: planPins.issue }).from(planPins).where(eq(planPins.projectId, projectId)).orderBy(asc(planPins.issue)),
    read.forecasts ?? loadForecasts(db, projectId, (issue) => byNumber.get(issue)?.size).then((f) => f.forecasts),
  ]);
  // Holds keep only a scheduler that is on and not paused from starting runs.
  const on = scheduler?.enabled && !scheduler.pausedAt;
  return {
    tasks: read.items,
    runs: active,
    lanes: scheduler?.maxRuns ?? 1,
    order: scheduler?.order ?? "project",
    priorityOptions: read.priorityOptions,
    skipLabel: scheduler ? scheduler.skipLabel : "human",
    released,
    latest,
    held: on ? holds.map(holdText) : [],
    // A pin on a task that is closed or no longer in the plan is ignored; the next order write deletes it.
    pins: new Set(pins.map((p) => p.issue).filter((issue) => openTasks.has(issue))),
    minutes: Object.fromEntries(SIZES.map((size) => [size, forecasts[size].minutes])) as Record<PlanSize, number>,
  };
}
