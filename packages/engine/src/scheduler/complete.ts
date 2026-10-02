import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { brief, extraPathsOf, matchingEdges, mergeState, notifies, remember, runPath, RunStateSchema, summarizeOutput, type CheckResult, type CompiledGraph, type NodeMemory, type NodeResult, type RunState } from "@handoff/core";
import { appendEvents, edgeTraversals, nodeExecutions, projects, questions, runs, type DbTx, type NewEvent, type NodeExecutionRow } from "@handoff/db";
import { notifyFrom } from "../notify.ts";
import type { ExecutionError } from "../types.ts";

export class LeaseLostError extends Error {
  constructor(executionId: string) {
    super(`lease lost for execution ${executionId}`);
  }
}

const RECONCILE_MS = 10 * 60_000;

async function lockRun(tx: DbTx, runId: string) {
  const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update");
  if (!run) throw new Error(`run ${runId} not found`);
  return { run, state: RunStateSchema.parse(run.state) };
}

const owned = (row: NodeExecutionRow, workerId: string) =>
  and(eq(nodeExecutions.id, row.id), eq(nodeExecutions.leaseOwner, workerId), eq(nodeExecutions.status, "running"));

const releasedLease = { leaseOwner: null, leaseExpiresAt: null, childPid: null, childHost: null } as const;

async function othersActive(tx: DbTx, runId: string, excludeId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(nodeExecutions)
    .where(and(eq(nodeExecutions.runId, runId), ne(nodeExecutions.id, excludeId), inArray(nodeExecutions.status, ["pending", "running", "waiting"])));
  return row?.n ?? 0;
}

type RouteResult = { events: NewEvent[]; created: number; arrived: number; exhausted: boolean; state: RunState };

type Trigger = NonNullable<NodeExecutionRow["trigger"]>;

export async function createExecution(tx: DbTx, graph: CompiledGraph, runId: string, target: string, trigger: Trigger) {
  const [{ attempt } = { attempt: 0 }] = await tx
    .select({ attempt: sql<number>`coalesce(max(${nodeExecutions.attempt}), 0)::int` })
    .from(nodeExecutions)
    .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeKey, target)));
  const node = graph.node(target);
  const [row] = await tx
    .insert(nodeExecutions)
    .values({ runId, nodeKey: target, nodeType: node.type, executorKind: graph.executorKind(target), attempt: attempt + 1, trigger })
    .returning({ id: nodeExecutions.id, attempt: nodeExecutions.attempt });
  return row!;
}

/**
 * Follows matching out-edges: loop guards (exhaustion routes to the gate), fan-in joins recorded in
 * edge_traversals, and a new node execution per edge taken.
 */
async function route(
  tx: DbTx,
  graph: CompiledGraph,
  row: NodeExecutionRow,
  outcome: "passed" | "failed",
  output: unknown,
  state: RunState,
): Promise<RouteResult> {
  const edges = matchingEdges(graph, row.nodeKey, outcome, {
    state,
    node: { key: row.nodeKey, status: outcome, attempt: row.attempt, output },
  });
  const events: NewEvent[] = [];
  let created = 0;
  let arrived = 0;
  let exhausted = false;
  let next = state;
  for (const edge of edges) {
    let target = edge.target;
    let trigger: Trigger = { kind: "edge", edgeKey: edge.key, from: row.nodeKey, fromExecutionId: row.id };
    if (edge.loop) {
      const attempts = next.loops[edge.key]?.attempts ?? 0;
      // A loop without a limit (a question gate's answers) counts its rounds but never runs out.
      if (edge.maxAttempts !== undefined && attempts >= edge.maxAttempts) {
        events.push({ type: "edge.exhausted", payload: { edgeKey: edge.key, attempts }, nodeExecutionId: row.id });
        const gate = edge.onExhausted ?? graph.document.attributes.exhaustedGate;
        if (!gate) {
          exhausted = true;
          continue;
        }
        target = gate;
        trigger = { kind: "exhausted", edgeKey: edge.key, from: row.nodeKey, fromExecutionId: row.id };
      } else {
        next = { ...next, loops: { ...next.loops, [edge.key]: { attempts: attempts + 1 } } };
      }
    }

    const inbound = graph.inEdges(target).filter((e) => !e.loop);
    if (!edge.loop && trigger.kind === "edge" && inbound.length > 1) {
      arrived++;
      await tx.insert(edgeTraversals).values({ runId: row.runId, edgeKey: edge.key, fromExecutionId: row.id, toNodeKey: target });
      events.push({ type: "join.arrived", payload: { nodeKey: target, edgeKey: edge.key, from: row.nodeKey }, nodeExecutionId: row.id });
      const pending = await tx
        .select({ id: edgeTraversals.id, edgeKey: edgeTraversals.edgeKey })
        .from(edgeTraversals)
        .where(and(eq(edgeTraversals.runId, row.runId), eq(edgeTraversals.toNodeKey, target), isNull(edgeTraversals.consumedByExecutionId)));
      const mode = graph.node(target).config.join === "any" ? "any" : "all";
      let consumer: string | undefined;
      if (mode === "any") {
        const [existing] = await tx
          .select({ id: nodeExecutions.id })
          .from(nodeExecutions)
          .where(and(eq(nodeExecutions.runId, row.runId), eq(nodeExecutions.nodeKey, target), ne(nodeExecutions.status, "failed")));
        consumer = existing?.id;
        if (!consumer) {
          const exec = await createExecution(tx, graph, row.runId, target, trigger);
          consumer = exec.id;
          created++;
          events.push({ type: "join.fired", payload: { nodeKey: target, mode }, nodeExecutionId: exec.id });
          events.push({ type: "node.created", payload: { nodeKey: target, attempt: exec.attempt, via: edge.key }, nodeExecutionId: exec.id });
        }
      } else {
        const arrivedKeys = new Set(pending.map((p) => p.edgeKey));
        if (inbound.every((e) => arrivedKeys.has(e.key))) {
          const exec = await createExecution(tx, graph, row.runId, target, trigger);
          consumer = exec.id;
          created++;
          events.push({ type: "join.fired", payload: { nodeKey: target, mode }, nodeExecutionId: exec.id });
          events.push({ type: "node.created", payload: { nodeKey: target, attempt: exec.attempt, via: edge.key }, nodeExecutionId: exec.id });
        }
      }
      if (consumer) {
        await tx
          .update(edgeTraversals)
          .set({ consumedByExecutionId: consumer })
          .where(inArray(edgeTraversals.id, pending.map((p) => p.id)));
      }
      continue;
    }

    const exec = await createExecution(tx, graph, row.runId, target, trigger);
    created++;
    events.push({ type: "edge.taken", payload: { edgeKey: edge.key, from: row.nodeKey, to: target }, nodeExecutionId: row.id });
    events.push({ type: "node.created", payload: { nodeKey: target, attempt: exec.attempt, via: edge.key }, nodeExecutionId: exec.id });
  }
  return { events, created, arrived, exhausted, state: next };
}

/** Records what this attempt adds to its node's memory, so later attempts of the node are told it too. */
function rememberAttempt(state: RunState, row: NodeExecutionRow, output: unknown): RunState {
  const extraPaths = extraPathsOf(output).map((e) => ({ ...e, attempt: row.attempt }));
  // The repaired attempt reads its own note from its row; the attempts after it read it from here.
  const notes = row.repairNote ? [{ note: row.repairNote, attempt: row.attempt }] : [];
  return extraPaths.length || notes.length ? remember(state, row.nodeKey, { extraPaths, notes }) : state;
}

/** Additions to the memory of one or more nodes, by node key. */
export type MemoryAdditions = Record<string, Partial<NodeMemory>>;

/** Appends to nodes' memory in the state read under the run's lock. */
function addMemory(state: RunState, additions: MemoryAdditions | undefined): RunState {
  return Object.entries(additions ?? {}).reduce((next, [nodeKey, add]) => remember(next, nodeKey, add), state);
}

/**
 * Tells a person how the run ended, when the node that ended it has that kind on. The notification
 * commits with the run's end.
 */
async function tellEnd(tx: DbTx, graph: CompiledGraph, runId: string, row: NodeExecutionRow, kind: "failed" | "finished", title: (project: string) => string) {
  const node = graph.node(row.nodeKey);
  if (!notifies(node, kind)) return;
  const [run] = await tx.select({ projectId: runs.projectId, project: projects.name, task: runs.task }).from(runs).innerJoin(projects, eq(projects.id, runs.projectId)).where(eq(runs.id, runId));
  if (!run) throw new Error(`run ${runId} not found`);
  await notifyFrom(tx, node, kind, { id: runId, projectId: run.projectId }, { title: title(run.project), body: brief(run.task), href: runPath(run.projectId, runId) });
}

async function finishRouting(
  tx: DbTx,
  graph: CompiledGraph,
  runId: string,
  row: NodeExecutionRow,
  routed: RouteResult,
  leadEvents: NewEvent[],
  failure?: ExecutionError,
) {
  const active = await othersActive(tx, runId, row.id);
  const events = [...leadEvents, ...routed.events];
  let status: "running" | "succeeded" | "failed" = "running";
  if (routed.created === 0 && routed.arrived === 0 && active === 0) {
    const deadEnd = graph.outEdges(row.nodeKey).length > 0;
    if (failure || routed.exhausted || deadEnd) {
      status = "failed";
      const reason = failure ? "node_failed" : routed.exhausted ? "loop_exhausted" : "no_route";
      await tellEnd(tx, graph, runId, row, "failed", (project) => (reason === "loop_exhausted" ? `${project}: ${row.nodeKey} ran out of rounds` : `${project}: run failed at ${row.nodeKey}`));
      events.push({
        type: "run.failed",
        payload: { nodeKey: row.nodeKey, reason, ...(failure ? { error: failure } : {}), awaiting: "repair" },
      });
    } else {
      status = "succeeded";
      await tellEnd(tx, graph, runId, row, "finished", (project) => `${project}: run finished`);
      events.push({ type: "run.succeeded", payload: {} });
    }
  }
  await tx
    .update(runs)
    .set({
      state: routed.state,
      stateVersion: sql`${runs.stateVersion} + 1`,
      ...(routed.state.prNumber !== undefined ? { prNumber: routed.state.prNumber } : {}),
      status,
      ...(status !== "running" ? { finishedAt: sql`now()` } : {}),
    })
    .where(eq(runs.id, runId));
  await appendEvents(tx, runId, events);
}

export async function completePassed(
  tx: DbTx,
  input: {
    row: NodeExecutionRow;
    workerId: string;
    graph: CompiledGraph;
    output: unknown;
    statePatch?: Record<string, unknown> | undefined;
    checks: CheckResult[];
    cost?: { usd?: number | undefined; usage?: unknown } | undefined;
    /** What to add to nodes' memory, appended to the run's current state under its lock so no concurrent write is lost. */
    memory?: MemoryAdditions | undefined;
  },
) {
  const { row } = input;
  const { run, state } = await lockRun(tx, row.runId);
  const [updated] = await tx
    .update(nodeExecutions)
    .set({
      ...releasedLease,
      status: "passed",
      output: input.output,
      checks: input.checks,
      finishedAt: sql`now()`,
      ...(input.cost?.usd !== undefined ? { costUsd: input.cost.usd.toFixed(6) } : {}),
      ...(input.cost?.usage !== undefined ? { usage: input.cost.usage } : {}),
    })
    .where(owned(row, input.workerId))
    .returning();
  if (!updated) throw new LeaseLostError(row.id);
  if (run.status === "cancelled") return;
  const lead: NewEvent[] = [];
  if (row.repairedFromExecutionId) {
    await tx.update(nodeExecutions).set({ status: "repaired" }).where(eq(nodeExecutions.id, row.repairedFromExecutionId));
    lead.push({ type: "node.repaired", payload: { nodeKey: row.nodeKey, repairedBy: row.id }, nodeExecutionId: row.repairedFromExecutionId });
  }
  const result: NodeResult = {
    output: input.output,
    executionId: row.id,
    attempt: row.attempt,
    ...(updated.executorSessionId ? { sessionId: updated.executorSessionId } : {}),
  };
  const merged = addMemory(rememberAttempt(mergeState(state, row.nodeKey, result, input.statePatch), row, input.output), input.memory);
  const routed = await route(tx, input.graph, row, "passed", input.output, merged);
  lead.push(
    ...input.checks.map((check) => ({ type: "contract.checked", payload: check, nodeExecutionId: row.id })),
    {
      type: "node.passed",
      payload: {
        nodeKey: row.nodeKey,
        attempt: row.attempt,
        ...summaryOf(input.output),
        ...(input.cost?.usd !== undefined ? { costUsd: input.cost.usd } : {}),
        ...(row.startedAt ? { durationMs: Date.now() - row.startedAt.getTime() } : {}),
      },
      nodeExecutionId: row.id,
    },
  );
  await finishRouting(tx, input.graph, row.runId, row, routed, lead);
}

export async function completeFailed(
  tx: DbTx,
  input: {
    row: NodeExecutionRow;
    workerId: string | null;
    graph: CompiledGraph;
    error: ExecutionError;
    output?: unknown;
    checks?: CheckResult[] | undefined;
  },
) {
  const { row } = input;
  const { run, state } = await lockRun(tx, row.runId);
  if (input.workerId) {
    const [updated] = await tx
      .update(nodeExecutions)
      .set({
        ...releasedLease,
        status: "failed",
        error: input.error,
        checks: input.checks ?? [],
        ...(input.output !== undefined ? { output: input.output } : {}),
        finishedAt: sql`now()`,
      })
      .where(owned(row, input.workerId))
      .returning();
    if (!updated) throw new LeaseLostError(row.id);
  }
  if (run.status === "cancelled") {
    await appendEvents(tx, row.runId, [{ type: "node.failed", payload: { nodeKey: row.nodeKey, attempt: row.attempt, error: input.error }, nodeExecutionId: row.id }]);
    return;
  }
  const previous = state.nodes[row.nodeKey];
  const failed: NodeResult = {
    output: input.output ?? previous?.output,
    executionId: row.id,
    attempt: row.attempt,
    lastFailure: { checks: input.checks ?? [], error: input.error },
  };
  const merged = rememberAttempt(mergeState(state, row.nodeKey, failed), row, input.output);
  const routed = await route(tx, input.graph, row, "failed", input.output, merged);
  const lead: NewEvent[] = [
    ...(input.checks ?? []).map((check) => ({ type: "contract.checked", payload: check, nodeExecutionId: row.id })),
    { type: "node.failed", payload: { nodeKey: row.nodeKey, attempt: row.attempt, error: input.error }, nodeExecutionId: row.id },
  ];
  await finishRouting(tx, input.graph, row.runId, row, routed, lead, input.error);
}

function summaryOf(output: unknown): { summary?: string } {
  const summary = summarizeOutput(output);
  return summary ? { summary } : {};
}

export async function yieldWaiting(
  tx: DbTx,
  input: { row: NodeExecutionRow; workerId: string; wait: { kind: "github_pr" | "human" | "timer" | "merge_queue"; key?: string | undefined; token?: string | undefined; deadlineAt?: Date | undefined } },
) {
  const { row, wait } = input;
  await lockRun(tx, row.runId);
  const deadline = wait.deadlineAt ?? (wait.kind === "github_pr" ? new Date(Date.now() + RECONCILE_MS) : null);
  const [updated] = await tx
    .update(nodeExecutions)
    .set({
      ...releasedLease,
      status: sql`(case when ${nodeExecutions.wakeRequestedAt} > ${nodeExecutions.claimedAt} then 'pending' else 'waiting' end)::node_execution_status`,
      runnableAt: sql`now()`,
      waitKind: wait.kind,
      waitKey: wait.key ?? row.waitKey,
      waitToken: wait.token ?? null,
      waitDeadlineAt: deadline,
    })
    .where(owned(row, input.workerId))
    .returning();
  if (!updated) throw new LeaseLostError(row.id);
  const active = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(nodeExecutions)
    .where(and(eq(nodeExecutions.runId, row.runId), inArray(nodeExecutions.status, ["pending", "running"])));
  if ((active[0]?.n ?? 0) === 0) await tx.update(runs).set({ status: "waiting" }).where(eq(runs.id, row.runId));
  await appendEvents(tx, row.runId, [
    {
      type: updated.status === "pending" ? "node.woken" : "node.waiting",
      payload: { nodeKey: row.nodeKey, waitKind: wait.kind, waitKey: updated.waitKey, deadlineAt: deadline?.toISOString() ?? null },
      nodeExecutionId: row.id,
    },
  ]);
}

/** The answers to a paths question: allow the files for this run, send the work back, or fail the step. */
export const PATHS_OPTIONS = ["allow", "send_back", "fail"] as const;

/**
 * A step whose only failing check is the path check waits for a person instead of failing. Its output,
 * checks and cost stay on the execution; the question names the files outside the plan.
 */
export async function askAboutPaths(
  tx: DbTx,
  input: {
    row: NodeExecutionRow;
    workerId: string;
    graph: CompiledGraph;
    output: unknown;
    checks: CheckResult[];
    files: string[];
    cost?: { usd?: number | undefined; usage?: unknown } | undefined;
  },
) {
  const { row, files } = input;
  const [kept] = await tx
    .update(nodeExecutions)
    .set({
      output: input.output,
      checks: input.checks,
      ...(input.cost?.usd !== undefined ? { costUsd: input.cost.usd.toFixed(6) } : {}),
      ...(input.cost?.usage !== undefined ? { usage: input.cost.usage } : {}),
    })
    .where(owned(row, input.workerId))
    .returning({ id: nodeExecutions.id });
  if (!kept) throw new LeaseLostError(row.id);
  const text = `${row.nodeKey} changed files outside the plan: ${files.map((f) => `\`${f}\``).join(", ")}`;
  const summary = `${row.nodeKey} changed ${files.length === 1 ? "a file" : `${files.length} files`} outside the plan`;
  const [question] = await tx
    .insert(questions)
    .values({ runId: row.runId, nodeExecutionId: row.id, question: text, options: [...PATHS_OPTIONS], context: { reason: "paths", from: row.nodeKey, files, summary } })
    .returning();
  const events: NewEvent[] = [
    ...input.checks.map((check) => ({ type: "contract.checked", payload: check, nodeExecutionId: row.id })),
    { type: "human.asked", payload: { questionId: question!.id, question: text, options: question!.options }, nodeExecutionId: row.id },
  ];
  const node = input.graph.node(row.nodeKey);
  if (notifies(node, "input")) {
    const [run] = await tx.select({ projectId: runs.projectId, project: projects.name }).from(runs).innerJoin(projects, eq(projects.id, runs.projectId)).where(eq(runs.id, row.runId));
    if (!run) throw new Error(`run ${row.runId} not found`);
    await notifyFrom(tx, node, "input", { id: row.runId, projectId: run.projectId }, { title: `${run.project}: ${summary}`, body: brief(files.join(", ")), href: runPath(run.projectId, row.runId) });
  }
  await appendEvents(tx, row.runId, events);
  await yieldWaiting(tx, { row, workerId: input.workerId, wait: { kind: "human", token: question!.id } });
}

/**
 * Fails the attempt and starts the node's next attempt at once with a note, the way a repair does,
 * so the run goes on without routing the failure.
 */
async function sendBack(tx: DbTx, input: { row: NodeExecutionRow; workerId: string; error: ExecutionError; checks: CheckResult[]; note: string }) {
  const { row, error } = input;
  const { state } = await lockRun(tx, row.runId);
  const [updated] = await tx
    .update(nodeExecutions)
    .set({ ...releasedLease, status: "failed", error, finishedAt: sql`now()` })
    .where(owned(row, input.workerId))
    .returning();
  if (!updated) throw new LeaseLostError(row.id);
  const failed: NodeResult = { output: row.output, executionId: row.id, attempt: row.attempt, lastFailure: { checks: input.checks, error } };
  const next = rememberAttempt(mergeState(state, row.nodeKey, failed), row, row.output);
  const [created] = await tx
    .insert(nodeExecutions)
    .values({
      runId: row.runId,
      nodeKey: row.nodeKey,
      nodeType: row.nodeType,
      executorKind: row.executorKind,
      attempt: row.attempt + 1,
      repairedFromExecutionId: row.id,
      repairNote: input.note,
      trigger: { kind: "repair", fromExecutionId: row.id },
    })
    .returning({ id: nodeExecutions.id, attempt: nodeExecutions.attempt });
  await tx.update(runs).set({ state: next, stateVersion: sql`${runs.stateVersion} + 1`, status: "running" }).where(eq(runs.id, row.runId));
  await appendEvents(tx, row.runId, [
    { type: "node.failed", payload: { nodeKey: row.nodeKey, attempt: row.attempt, error }, nodeExecutionId: row.id },
    { type: "node.created", payload: { nodeKey: row.nodeKey, attempt: created!.attempt, via: "paths" }, nodeExecutionId: created!.id },
  ]);
}

type PathsQuestion = { option: string | null; answer: string | null; answeredBy: string | null; context: Record<string, unknown> };

/**
 * Carries out a person's answer to a paths question on the execution that waited for it. Allow
 * passes the attempt with the files in the node's memory, so its later attempts may change them too.
 */
export async function resolvePaths(tx: DbTx, input: { row: NodeExecutionRow; workerId: string; graph: CompiledGraph; question: PathsQuestion }) {
  const { row, question } = input;
  const files = Array.isArray(question.context.files) ? question.context.files.map(String) : [];
  const by = question.answeredBy ?? "a person";
  const note = question.answer && question.answer !== question.option ? question.answer.trim() : "";
  const checks = (row.checks ?? []) as CheckResult[];
  const listed = files.map((f) => `\`${f}\``).join(", ");
  const error: ExecutionError = { code: "paths_outside_plan", message: `files outside the plan: ${files.join(", ")}`, detail: { files } };
  if (question.option === "fail") return completeFailed(tx, { row, workerId: input.workerId, graph: input.graph, error, output: row.output, checks });
  // An answer without a known option (a text answer over MCP, say) sends the work back with it rather than guessing.
  if (question.option !== "allow") {
    const told = [
      `${by} sent this back because it changed files outside the plan: ${listed}.`,
      "Undo your changes to them. If the task cannot be done without one, keep it and list it in extraPaths with the reason.",
      ...(note ? [`They said: ${note}`] : []),
    ].join(" ");
    return sendBack(tx, { row, workerId: input.workerId, error, checks, note: told });
  }
  const reason = `Allowed by ${by} for this run${note ? `: ${note}` : "."}`;
  const allowed = checks.map((c) => (c.kind === "diff_within_paths" && !c.passed ? { ...c, passed: true, detail: `files outside owned paths allowed by ${by}: ${files.join(", ")}` } : c));
  const extraPaths = files.map((path) => ({ path, reason, attempt: row.attempt, by: "person" as const }));
  await completePassed(tx, { row, workerId: input.workerId, graph: input.graph, output: row.output, checks: allowed, memory: { [row.nodeKey]: { extraPaths } } });
}

export async function releaseForReclaim(tx: DbTx, input: { row: NodeExecutionRow; workerId: string }) {
  const [updated] = await tx
    .update(nodeExecutions)
    .set({ ...releasedLease, status: "pending", runnableAt: sql`now()`, interruptCount: sql`${nodeExecutions.interruptCount} + 1` })
    .where(owned(input.row, input.workerId))
    .returning();
  if (!updated) throw new LeaseLostError(input.row.id);
  await appendEvents(tx, input.row.runId, [
    { type: "node.interrupted", payload: { nodeKey: input.row.nodeKey }, nodeExecutionId: input.row.id },
  ]);
}

/** Puts a retryable failure back in the queue after a delay, keeping the same execution and session. */
export async function scheduleRetry(tx: DbTx, input: { row: NodeExecutionRow; workerId: string; error: ExecutionError; delayMs: number }) {
  const { row } = input;
  const [updated] = await tx
    .update(nodeExecutions)
    .set({
      ...releasedLease,
      status: "pending",
      error: input.error,
      retryCount: sql`${nodeExecutions.retryCount} + 1`,
      runnableAt: sql`now() + (${Math.max(0, Math.round(input.delayMs))}::int * interval '1 millisecond')`,
    })
    .where(owned(row, input.workerId))
    .returning();
  if (!updated) throw new LeaseLostError(row.id);
  await appendEvents(tx, row.runId, [
    {
      type: "node.retrying",
      payload: { nodeKey: row.nodeKey, attempt: row.attempt, retry: updated.retryCount, delayMs: input.delayMs, error: input.error },
      nodeExecutionId: row.id,
    },
  ]);
}
