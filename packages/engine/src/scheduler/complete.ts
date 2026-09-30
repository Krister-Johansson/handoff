import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { matchingEdges, mergeState, RunStateSchema, type CheckResult, type CompiledGraph, type NodeResult, type RunState } from "@handoff/core";
import { appendEvents, edgeTraversals, nodeExecutions, runs, type DbTx, type NewEvent, type NodeExecutionRow } from "@handoff/db";
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

async function createExecution(tx: DbTx, graph: CompiledGraph, runId: string, target: string, trigger: Trigger) {
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
      if (attempts >= (edge.maxAttempts ?? 0)) {
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
      events.push({
        type: "run.failed",
        payload: { nodeKey: row.nodeKey, reason, ...(failure ? { error: failure } : {}), awaiting: "repair" },
      });
    } else {
      status = "succeeded";
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
  const merged = mergeState(state, row.nodeKey, result, input.statePatch);
  const routed = await route(tx, input.graph, row, "passed", input.output, merged);
  lead.push(
    ...input.checks.map((check) => ({ type: "contract.checked", payload: check, nodeExecutionId: row.id })),
    { type: "node.passed", payload: { nodeKey: row.nodeKey, attempt: row.attempt }, nodeExecutionId: row.id },
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
  const merged = mergeState(state, row.nodeKey, failed);
  const routed = await route(tx, input.graph, row, "failed", input.output, merged);
  const lead: NewEvent[] = [
    ...(input.checks ?? []).map((check) => ({ type: "contract.checked", payload: check, nodeExecutionId: row.id })),
    { type: "node.failed", payload: { nodeKey: row.nodeKey, attempt: row.attempt, error: input.error }, nodeExecutionId: row.id },
  ];
  await finishRouting(tx, input.graph, row.runId, row, routed, lead, input.error);
}

export async function yieldWaiting(
  tx: DbTx,
  input: { row: NodeExecutionRow; workerId: string; wait: { kind: "github_pr" | "human" | "timer"; key?: string | undefined; token?: string | undefined; deadlineAt?: Date | undefined } },
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
