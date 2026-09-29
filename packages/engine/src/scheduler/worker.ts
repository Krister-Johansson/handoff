import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { RunStateSchema } from "@handoff/core";
import {
  appendEvents,
  claimNext,
  heartbeat,
  nodeExecutions,
  projects,
  reapExpiredLeases,
  reapExpiredWaits,
  runs,
  type Caps,
  type Db,
  type NewEvent,
  type NodeExecutionRow,
} from "@handoff/db";
import { validateContract } from "../contract/validate.ts";
import { LibraryUnavailableError, materializeLibrary, type MaterializedLibrary } from "../library/materialize.ts";
import { selectContext } from "../context.ts";
import { loadCompiledGraph } from "../graph-cache.ts";
import type { ExecutorOutcome, ExecutorRegistry, Workdir, WorkdirProvider } from "../types.ts";
import { completeFailed, completePassed, LeaseLostError, releaseForReclaim, yieldWaiting } from "./complete.ts";

export type EngineDeps = {
  db: Db;
  workerId: string;
  caps: Caps;
  leaseMs: number;
  executors: ExecutorRegistry;
  workdirs: WorkdirProvider;
  /** Per-execution scratch dirs (context packet, skills, mcp.json) live under this root. */
  stagingRoot: string;
  maxReclaims?: number;
  /** Resolves the git remote for a project; defaults to localClonePath or the GitHub https URL. */
  remoteUrl?: (project: typeof projects.$inferSelect) => string;
  log?: (message: string, detail?: unknown) => void;
  /** Where ${secret:NAME} references in the library resolve from. Defaults to process.env. */
  secrets?: Record<string, string | undefined>;
};

const EVENT_FLUSH_MS = 100;

/** Reaps expired leases and waits, then claims and executes at most one node execution. */
export async function runOnce(deps: EngineDeps): Promise<boolean> {
  await reap(deps);
  const row = await claimNext(deps.db, { workerId: deps.workerId, caps: deps.caps, leaseMs: deps.leaseMs });
  if (!row) return false;
  await executeClaimed(deps, row);
  return true;
}

export type WorkerHandle = { stop(): Promise<void> };

/** Long-running loop: keeps up to maxInFlight executions running, polling when idle. */
export function startWorker(deps: EngineDeps, opts: { pollIntervalMs?: number; maxInFlight?: number } = {}): WorkerHandle {
  const poll = opts.pollIntervalMs ?? 1000;
  const maxInFlight = opts.maxInFlight ?? 4;
  const inFlight = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  let stopping = false;
  let wake: (() => void) | undefined;

  const loop = (async () => {
    while (!stopping) {
      if (inFlight.size < maxInFlight) {
        try {
          await reap(deps);
          const row = await claimNext(deps.db, { workerId: deps.workerId, caps: deps.caps, leaseMs: deps.leaseMs });
          if (row) {
            const controller = new AbortController();
            controllers.add(controller);
            const task = executeClaimed(deps, row, controller.signal)
              .catch((error) => deps.log?.("execution crashed", { id: row.id, error: String(error) }))
              .finally(() => {
                inFlight.delete(task);
                controllers.delete(controller);
                wake?.();
              });
            inFlight.add(task);
            continue;
          }
        } catch (error) {
          deps.log?.("worker loop error", String(error));
        }
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, poll);
      });
    }
  })();

  return {
    async stop() {
      stopping = true;
      wake?.();
      for (const controller of controllers) controller.abort();
      await loop;
      await Promise.allSettled([...inFlight]);
    },
  };
}

async function reap(deps: EngineDeps) {
  const { db } = deps;
  const leases = await reapExpiredLeases(db, { maxReclaims: deps.maxReclaims ?? 2 });
  const waits = await reapExpiredWaits(db);
  const ids = [...leases.reclaimed, ...leases.failed, ...waits];
  if (ids.length === 0) return;
  const rows = await db.select().from(nodeExecutions).where(inArray(nodeExecutions.id, ids));
  for (const row of rows) {
    await db.transaction(async (tx) => {
      if (leases.failed.includes(row.id)) {
        const [run] = await tx.select().from(runs).where(eq(runs.id, row.runId));
        const graph = await loadCompiledGraph(tx, run!.graphVersionId);
        await completeFailed(tx, { row, workerId: null, graph, error: row.error ?? { code: "reclaim_limit", message: "lease expired" } });
      } else {
        const type = waits.includes(row.id) ? "node.woken" : "node.reclaimed";
        await appendEvents(tx, row.runId, [{ type, payload: { nodeKey: row.nodeKey, reason: row.wakeReason ?? "lease_expired" }, nodeExecutionId: row.id }]);
      }
    });
  }
}

function defaultRemote(project: typeof projects.$inferSelect): string {
  return project.localClonePath ?? `https://github.com/${project.repoOwner}/${project.repoName}.git`;
}

async function executeClaimed(deps: EngineDeps, row: NodeExecutionRow, outerSignal?: AbortSignal): Promise<void> {
  const { db, workerId } = deps;
  const [run] = await db.select().from(runs).where(eq(runs.id, row.runId));
  if (!run) throw new Error(`run ${row.runId} not found`);
  const [project] = await db.select().from(projects).where(eq(projects.id, run.projectId));
  if (!project) throw new Error(`project ${run.projectId} not found`);
  const graph = await loadCompiledGraph(db, run.graphVersionId);
  const node = graph.node(row.nodeKey);
  const state = RunStateSchema.parse(run.state);

  await db.transaction(async (tx) => {
    const started = await tx
      .update(runs)
      .set({ status: "running", startedAt: sql`coalesce(${runs.startedAt}, now())` })
      .where(eq(runs.id, run.id))
      .returning({ startedAt: runs.startedAt });
    const events: NewEvent[] = [];
    if (run.status === "queued") events.push({ type: "run.started", payload: {} });
    events.push({
      type: "node.claimed",
      payload: { nodeKey: row.nodeKey, attempt: row.attempt, workerId, wakeReason: row.wakeReason },
      nodeExecutionId: row.id,
    });
    void started;
    await appendEvents(tx, run.id, events);
  });

  const controller = new AbortController();
  const abort = () => controller.abort();
  outerSignal?.addEventListener("abort", abort, { once: true });
  let leaseLost = false;
  let cancelled = false;
  const beat = setInterval(async () => {
    try {
      const status = await heartbeat(db, row.id, workerId, deps.leaseMs);
      if (!status.alive) leaseLost = true;
      if (status.cancelRequested) cancelled = true;
      if (leaseLost || cancelled) controller.abort();
    } catch (error) {
      deps.log?.("heartbeat failed", String(error));
    }
  }, Math.max(50, Math.floor(deps.leaseMs / 3)));

  let buffer: NewEvent[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    await db.transaction((tx) => appendEvents(tx, run.id, batch));
  };
  const flusher = setInterval(() => void flush().catch((e) => deps.log?.("event flush failed", String(e))), EVENT_FLUSH_MS);

  const stagingDir = join(deps.stagingRoot, row.id);
  mkdirSync(stagingDir, { recursive: true });
  let outcome: ExecutorOutcome;
  let workdir: Workdir | undefined;
  try {
    const executor = deps.executors[node.type];
    if (!executor) {
      outcome = { kind: "failed", error: { code: "no_executor", message: `no executor registered for node type ${node.type}` } };
    } else {
      if (executor.needsWorkdir) {
        workdir = await deps.workdirs.acquire({
          runId: run.id,
          remoteUrl: (deps.remoteUrl ?? defaultRemote)(project),
          baseBranch: run.baseBranch,
          branchName: run.branchName,
        });
        if (run.worktreePath !== workdir.path) await db.update(runs).set({ worktreePath: workdir.path }).where(eq(runs.id, run.id));
      }
      let library: MaterializedLibrary | undefined;
      if (graph.executorKind(node.key) === "cli") {
        const overrides = row.trigger?.kind === "edge" && row.trigger.edgeKey ? graph.graph.getEdgeAttributes(row.trigger.edgeKey).overrides : undefined;
        const selection = {
          skills: [...new Set([...node.library.skills, ...(overrides?.skills ?? [])])],
          mcp: [...new Set([...node.library.mcp, ...(overrides?.mcp ?? [])])],
          agents: [...new Set([...node.library.agents, ...(overrides?.agents ?? [])])],
        };
        if (selection.skills.length || selection.mcp.length || selection.agents.length) {
          library = await materializeLibrary(db, selection, stagingDir, deps.secrets ?? process.env);
          buffer.push({ type: "library.materialized", payload: library.used, nodeExecutionId: row.id });
        }
      }
      const packet = selectContext(node, state, row);
      if (library?.allowedTools.length) packet.constraints.allowedTools = [...packet.constraints.allowedTools, ...library.allowedTools];
      await db.update(nodeExecutions).set({ contextPacket: packet }).where(eq(nodeExecutions.id, row.id));
      outcome = await executor.execute({
        run,
        project,
        execution: row,
        node,
        graph,
        state,
        packet,
        ...(workdir ? { workdir } : {}),
        stagingDir,
        ...(library ? { library } : {}),
        signal: controller.signal,
        emit: (type, payload) => void buffer.push({ type, payload, nodeExecutionId: row.id }),
        setSessionId: async (id) => {
          await db.update(nodeExecutions).set({ executorSessionId: id }).where(eq(nodeExecutions.id, row.id));
          row = { ...row, executorSessionId: id };
        },
        registerWait: async (key) => {
          await db.update(nodeExecutions).set({ waitKey: key }).where(eq(nodeExecutions.id, row.id));
          row = { ...row, waitKey: key };
        },
      });
    }
  } catch (error) {
    outcome =
      error instanceof LibraryUnavailableError
        ? { kind: "failed", error: { code: "library_unavailable", message: error.message } }
        : { kind: "failed", error: { code: "executor_crashed", message: (error as Error).message } };
  } finally {
    clearInterval(beat);
    clearInterval(flusher);
    outerSignal?.removeEventListener("abort", abort);
    rmSync(stagingDir, { recursive: true, force: true });
  }
  await flush();

  const final = await heartbeat(db, row.id, workerId, deps.leaseMs);
  if (!final.alive || leaseLost) {
    deps.log?.("lease lost; discarding result", { id: row.id });
    return;
  }
  if (cancelled || final.cancelRequested) {
    outcome = { kind: "failed", error: { code: "cancelled", message: "run was cancelled" } };
  } else if (outerSignal?.aborted && outcome.kind !== "completed") {
    outcome = { kind: "interrupted" };
  }

  try {
    await applyOutcome(deps, row, graph, state, run.baseBranch, workdir, outcome);
  } catch (error) {
    if (error instanceof LeaseLostError) deps.log?.("lease lost at completion", { id: row.id });
    else throw error;
  }
  await releaseIfFinished(deps, run.id, project);
}

const TERMINAL_RUN = new Set(["succeeded", "failed", "cancelled"]);

/** A finished run gives its worktree back; the branch stays so a repair can re-create it. */
async function releaseIfFinished(deps: EngineDeps, runId: string, project: typeof projects.$inferSelect) {
  const [run] = await deps.db.select().from(runs).where(eq(runs.id, runId));
  if (!run || !TERMINAL_RUN.has(run.status)) return;
  try {
    await deps.workdirs.release({
      runId: run.id,
      remoteUrl: (deps.remoteUrl ?? defaultRemote)(project),
      baseBranch: run.baseBranch,
      branchName: run.branchName,
    });
  } catch (error) {
    deps.log?.("workdir release failed", { runId, error: String(error) });
  }
}

async function applyOutcome(
  deps: EngineDeps,
  row: NodeExecutionRow,
  graph: Awaited<ReturnType<typeof loadCompiledGraph>>,
  state: ReturnType<typeof RunStateSchema.parse>,
  baseBranch: string,
  workdir: Workdir | undefined,
  outcome: ExecutorOutcome,
) {
  const { db, workerId } = deps;
  const node = graph.node(row.nodeKey);
  switch (outcome.kind) {
    case "completed": {
      const contract = await validateContract(node.contract, outcome.output, { state: { ...state, ...outcome.statePatch }, baseBranch, workdir: workdir?.path });
      if (contract.passed) {
        await db.transaction((tx) =>
          completePassed(tx, { row, workerId, graph, output: contract.output, statePatch: outcome.statePatch, checks: contract.checks, cost: outcome.cost }),
        );
      } else {
        await db.transaction((tx) =>
          completeFailed(tx, {
            row,
            workerId,
            graph,
            output: contract.output ?? outcome.output,
            checks: contract.checks,
            error: { code: "contract_failed", message: contract.reason ?? "contract failed", ...(contract.issues ? { detail: contract.issues } : {}) },
          }),
        );
      }
      return;
    }
    case "waiting":
      await db.transaction((tx) => yieldWaiting(tx, { row, workerId, wait: outcome.wait }));
      return;
    case "failed":
      await db.transaction((tx) => completeFailed(tx, { row, workerId, graph, error: outcome.error }));
      return;
    case "interrupted":
      await db.transaction((tx) => releaseForReclaim(tx, { row, workerId }));
      return;
  }
}
