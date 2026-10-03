import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { brief, redactSecrets, runPath, RunStateSchema, type RunState } from "@handoff/core";
import { overlapKey } from "../backlog-scheduler/nudge.ts";
import { overlapWith } from "../backlog-scheduler/overlap.ts";
import { notifyFrom } from "../notify.ts";
import { stopWorkerPreviews } from "../preview/preview.ts";
import {
  appendEvents,
  claimNext,
  heartbeat,
  heartbeatWorker,
  registerWorker,
  stopWorker,
  nodeExecutions,
  projects,
  questions,
  reapExpiredLeases,
  reapExpiredWaits,
  runs,
  type Caps,
  type Db,
  type NewEvent,
  type NodeExecutionRow,
} from "@handoff/db";
import { shell } from "../contract/checks.ts";
import { validateContract } from "../contract/validate.ts";
import { LibraryUnavailableError, materializeLibrary, type MaterializedLibrary } from "../library/materialize.ts";
import { runIdentity, SetupFailedError, setUpWorkdir } from "../workdir/setup.ts";
import type { McpOAuthStore } from "../library/mcp-oauth.ts";
import { selectContext } from "../context.ts";
import { budgetFor, freshIssues, otherWorkOf } from "../planning.ts";
import type { GitHubPort } from "@handoff/github";
import { runAllowRules } from "../permissions/broker.ts";
import { loadCompiledGraph } from "../graph-cache.ts";
import { workdirSpecOf } from "../runs.ts";
import type { ExecutorOutcome, ExecutorRegistry, Workdir, WorkdirProvider, WorkdirSpec } from "../types.ts";
import { askAboutPaths, completeFailed, completePassed, failAndRetry, LeaseLostError, resolvePaths, releaseForReclaim, scheduleRetry, yieldWaiting } from "./complete.ts";

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
  /** Automatic retries for retryable failures (rate limits, timeouts) before the node fails. Default 3. */
  maxRetries?: number;
  /** Base backoff for retries without a hint; doubles each retry. Default 60 s. */
  retryBackoffMs?: number;
  /** Where ${secret:NAME} references in the library resolve from. Defaults to process.env. */
  secrets?: Record<string, string | undefined>;
  /** Where OAuth tokens for MCP servers are read from. Defaults to the store at defaultOAuthDir(). */
  oauth?: McpOAuthStore;
  /** GitHub, for what a planner reads before it plans: its issues and their comments, and the files of open pull requests. */
  github?: GitHubPort | undefined;
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

const ORPHAN_COMMAND = /claude|docker exec/;
const run = promisify(execFile);

/**
 * Stops claude children that a previous worker on this host left running (it crashed, or was
 * killed without a graceful stop). Their executions are reclaimed by lease expiry; killing the
 * child first means two claude processes never work on the same session.
 */
export async function killOrphans(deps: EngineDeps): Promise<string[]> {
  const rows = await deps.db
    .select({ id: nodeExecutions.id, runId: nodeExecutions.runId, nodeKey: nodeExecutions.nodeKey, pid: nodeExecutions.childPid })
    .from(nodeExecutions)
    .where(
      and(
        eq(nodeExecutions.status, "running"),
        isNotNull(nodeExecutions.childPid),
        eq(nodeExecutions.childHost, hostname()),
        ne(nodeExecutions.leaseOwner, deps.workerId),
      ),
    );
  const killed: string[] = [];
  for (const row of rows) {
    const command = await run("ps", ["-o", "command=", "-p", String(row.pid)]).then(
      (r) => r.stdout.trim(),
      () => "",
    );
    if (command && ORPHAN_COMMAND.test(command)) {
      try {
        process.kill(-row.pid!, "SIGTERM");
      } catch {
        try {
          process.kill(row.pid!, "SIGTERM");
        } catch {
          // already gone
        }
      }
      killed.push(row.id);
      await deps.db.transaction(async (tx) => {
        await tx.update(nodeExecutions).set({ childPid: null, childHost: null }).where(eq(nodeExecutions.id, row.id));
        await appendEvents(tx, row.runId, [{ type: "node.orphan_killed", payload: { nodeKey: row.nodeKey, pid: row.pid }, nodeExecutionId: row.id }]);
      });
    } else if (!command) {
      await deps.db.update(nodeExecutions).set({ childPid: null, childHost: null }).where(eq(nodeExecutions.id, row.id));
    }
  }
  return killed;
}

/** Long-running loop: keeps up to maxInFlight executions running, polling when idle. */
export function startWorker(deps: EngineDeps, opts: { pollIntervalMs?: number; maxInFlight?: number; heartbeatMs?: number } = {}): WorkerHandle {
  const poll = opts.pollIntervalMs ?? 1000;
  const maxInFlight = opts.maxInFlight ?? 4;
  const inFlight = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  let stopping = false;
  let wake: (() => void) | undefined;

  const beat = setInterval(() => void heartbeatWorker(deps.db, deps.workerId).catch(() => {}), opts.heartbeatMs ?? 15_000);
  const loop = (async () => {
    await registerWorker(deps.db, { id: deps.workerId, hostname: hostname(), caps: deps.caps });
    const orphans = await killOrphans(deps).catch((error) => {
      deps.log?.("orphan cleanup failed", String(error));
      return [];
    });
    if (orphans.length) deps.log?.(`stopped ${orphans.length} orphaned claude processes`);
    // Apps this worker started for people to try, before it stopped: nothing else would end them.
    await stopWorkerPreviews(deps.db, deps.workerId).catch((error) => deps.log?.("preview cleanup failed", String(error)));
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
      clearInterval(beat);
      await stopWorker(deps.db, deps.workerId);
    },
  };
}

async function reap(deps: EngineDeps) {
  const { db } = deps;
  const leases = await reapExpiredLeases(db, { maxReclaims: deps.maxReclaims ?? 2 });
  const waits = await reapExpiredWaits(db);
  await releaseEnded(deps);
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

/** Where a project's code is fetched from: its local clone when it has one, else its GitHub repository. */
export function defaultRemote(project: typeof projects.$inferSelect): string {
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
    if (run.status === "queued") {
      events.push({ type: "run.started", payload: {} });
      await notifyFrom(tx, node, "started", run, { title: `${project.name}: run started`, body: brief(run.task), href: runPath(project.id, run.id) });
    }
    events.push({
      type: "node.claimed",
      payload: { nodeKey: row.nodeKey, attempt: row.attempt, workerId, wakeReason: row.wakeReason },
      nodeExecutionId: row.id,
    });
    void started;
    await appendEvents(tx, run.id, events);
  });

  // An attempt that waited on a paths question goes on with the person's answer; its agent does not run again.
  const paths = row.waitToken ? await answeredPathsQuestion(db, row.waitToken) : undefined;
  if (paths) {
    try {
      await db.transaction((tx) => resolvePaths(tx, { row, workerId, graph, question: paths }));
    } catch (error) {
      if (error instanceof LeaseLostError) deps.log?.("lease lost at completion", { id: row.id });
      else throw error;
    }
    await releaseIfFinished(deps, run.id, project);
    return;
  }

  if (node.type === "coder" && row.attempt === 1 && run.startedBy === "scheduler" && state.plan) {
    if (await holdOnOverlap(deps, row, run, state.plan.ownedPaths)) return;
    row = { ...row, waitKey: null };
  }

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
  // Flushes run one after another, so the last one waits for a timed flush still writing.
  let flushing: Promise<void> = Promise.resolve();
  const flush = () =>
    (flushing = flushing.catch(() => {}).then(async () => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      await db.transaction((tx) => appendEvents(tx, run.id, batch));
    }));
  const flusher = setInterval(() => void flush().catch((e) => deps.log?.("event flush failed", String(e))), EVENT_FLUSH_MS);

  const stagingDir = join(deps.stagingRoot, row.id);
  mkdirSync(stagingDir, { recursive: true });
  let outcome: ExecutorOutcome;
  let workdir: Workdir | undefined;
  // The linked issues as a planner read them again from GitHub, kept in run state when it completes.
  let fresh: RunState["issues"];
  try {
    const executor = deps.executors[node.type];
    if (!executor) {
      outcome = { kind: "failed", error: { code: "no_executor", message: `no executor registered for node type ${node.type}` } };
    } else {
      if (typeof executor.needsWorkdir === "function" ? executor.needsWorkdir(node) : executor.needsWorkdir) {
        const spec = workdirSpecOf(run, (deps.remoteUrl ?? defaultRemote)(project));
        const emit = (type: string, payload: unknown) => void buffer.push({ type, payload, nodeExecutionId: row.id });
        workdir = await deps.workdirs.acquire(spec);
        if (run.worktreePath !== workdir.path) await db.update(runs).set({ worktreePath: workdir.path }).where(eq(runs.id, run.id));
        if (node.type === "coder" && row.attempt === 1) await fastForward(deps, spec, emit);
        if (project.setupCommand) await setUpWorkdir(workdir, project.setupCommand, emit, controller.signal, runIdentity(run.id, workdir.path));
      }
      let library: MaterializedLibrary | undefined;
      if (graph.executorKind(node.key) === "cli") {
        const overrides = row.trigger?.kind === "edge" && row.trigger.edgeKey ? graph.graph.getEdgeAttributes(row.trigger.edgeKey).overrides : undefined;
        // The project's default library applies to every CLI node, next to the node's own and the edge's overrides.
        const merge = (key: "skills" | "mcp" | "agents" | "groups") => [...new Set([...project.library[key], ...node.library[key], ...(overrides?.[key] ?? [])])];
        const selection = { skills: merge("skills"), mcp: merge("mcp"), agents: merge("agents"), groups: merge("groups") };
        if (selection.skills.length || selection.mcp.length || selection.agents.length || selection.groups.length) {
          library = await materializeLibrary(db, selection, stagingDir, deps.secrets ?? process.env, deps.oauth);
          buffer.push({ type: "library.materialized", payload: library.used, nodeExecutionId: row.id });
        }
      }
      // Where this node sends work back, so a reviewer's next round can read what that step changed.
      const sentBackTo = graph.outEdges(node.key).filter((e) => e.loop).map((e) => e.target);
      // Every planner attempt reads its issues again, with their comments, and is told its budget and the project's other work.
      if (node.type === "planner" && deps.github && state.issues?.length) fresh = await freshIssues(deps.github, project, state.issues);
      const seen = fresh ? { ...state, issues: fresh } : state;
      const packet = selectContext(node, seen, row, sentBackTo);
      if (node.type === "planner") {
        packet.budget = budgetFor(project, graph, node.key);
        packet.otherWork = await otherWorkOf(db, deps.github, run, project);
      }
      if (workdir) packet.environment = { branch: run.branchName, setupCommand: project.setupCommand, ...(project.agentNotes ? { agentNotes: project.agentNotes } : {}) };
      // A person's Always allow in this run covers the node's later attempts too, though the run keeps its graph version.
      const allowedInRun = graph.executorKind(node.key) === "cli" ? await runAllowRules(db, run.id, node.key) : [];
      const extraTools = [...(library?.allowedTools ?? []), ...allowedInRun];
      if (extraTools.length) packet.constraints.allowedTools = [...new Set([...packet.constraints.allowedTools, ...extraTools])];
      await db.update(nodeExecutions).set({ contextPacket: packet }).where(eq(nodeExecutions.id, row.id));
      outcome = await executor.execute({
        run,
        project,
        execution: row,
        node,
        graph,
        state: seen,
        packet,
        ...(workdir ? { workdir } : {}),
        stagingDir,
        ...(library ? { library } : {}),
        signal: controller.signal,
        emit: (type, payload) => void buffer.push({ type, payload, nodeExecutionId: row.id }),
        notify: (kind, told) => notifyFrom(db, node, kind, run, told),
        recordRepoId: async (repoId) => {
          await db.update(projects).set({ repoId }).where(eq(projects.id, project.id));
        },
        recordPrNumber: async (prNumber) => {
          await db.update(runs).set({ prNumber }).where(eq(runs.id, run.id));
        },
        setChildPid: async (pid) => {
          await db.update(nodeExecutions).set({ childPid: pid, childHost: hostname() }).where(eq(nodeExecutions.id, row.id));
        },
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
        : error instanceof SetupFailedError
          ? { kind: "failed", error: { code: "setup_failed", message: redactSecrets(error.message) } }
        : { kind: "failed", error: { code: "executor_crashed", message: redactSecrets((error as Error).message) } };
  } finally {
    clearInterval(beat);
    clearInterval(flusher);
    outerSignal?.removeEventListener("abort", abort);
    rmSync(stagingDir, { recursive: true, force: true });
  }
  await flush();
  if (fresh && outcome.kind === "completed") outcome = { ...outcome, statePatch: { ...outcome.statePatch, issues: fresh } };

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

const OVERLAP_RECHECK_MS = 10 * 60_000;

/**
 * Before the coder's first attempt of a run the scheduler started, a plan that shares paths with
 * another active run of the project waits, holding no Claude slot, until a run ends or a merge lands
 * (or ten minutes pass) and checks again. The wait key is set before the check, so a run that ends
 * during it still wakes this one. Returns whether the execution waits.
 */
async function holdOnOverlap(deps: EngineDeps, row: NodeExecutionRow, run: typeof runs.$inferSelect, ownedPaths: string[]): Promise<boolean> {
  const { db, workerId } = deps;
  const key = overlapKey(run.projectId);
  await db.update(nodeExecutions).set({ waitKey: key }).where(eq(nodeExecutions.id, row.id));
  const overlap = await overlapWith(db, run, ownedPaths);
  if (!overlap) {
    await db.update(nodeExecutions).set({ waitKey: null }).where(eq(nodeExecutions.id, row.id));
    return false;
  }
  try {
    await db.transaction(async (tx) => {
      await appendEvents(tx, run.id, [{ type: "run.overlap_held", payload: { nodeKey: row.nodeKey, ...overlap }, nodeExecutionId: row.id }]);
      await yieldWaiting(tx, { row, workerId, wait: { kind: "timer", key, deadlineAt: new Date(Date.now() + OVERLAP_RECHECK_MS) } });
    });
  } catch (error) {
    if (error instanceof LeaseLostError) deps.log?.("lease lost at overlap hold", { id: row.id });
    else throw error;
  }
  return true;
}

/**
 * Before the coder's first attempt, a branch with no commits of its own moves to the latest base, so
 * the coder works on the newest main and not on main as it was when the planner started. A failure
 * leaves the worktree where it was and is an event; the step goes on.
 */
async function fastForward(deps: EngineDeps, spec: WorkdirSpec, emit: (type: string, payload: unknown) => void) {
  try {
    const moved = await deps.workdirs.fastForward?.(spec);
    if (moved) emit("workdir.fast_forwarded", { base: spec.baseBranch, ...moved });
  } catch (error) {
    emit("workdir.fast_forward_failed", { base: spec.baseBranch, error: redactSecrets(String(error)) });
  }
}

const CONTINUE_NOTE =
  "Continue: the previous attempt ran out of turns. Its work is committed on this branch; read what it did with git, then finish the task from there.";

/**
 * A coder that ran out of turns, even after its wrap-up turn, but committed work gets one new attempt
 * that continues from the branch. An attempt that was itself such a continuation fails instead.
 */
async function continuesAfterMaxTurns(row: NodeExecutionRow, type: string, error: { code: string }, workdir: Workdir | undefined, baseBranch: string): Promise<boolean> {
  if (error.code !== "cli_error_max_turns" || type !== "coder" || !workdir || row.trigger?.reason === "continue") return false;
  const ahead = await run("git", ["rev-list", "--count", `origin/${baseBranch}..HEAD`], { cwd: workdir.path }).then(
    (r) => Number(r.stdout.trim()),
    () => 0,
  );
  return ahead > 0;
}

/** The answered paths question an execution waited on, if that is what woke it. */
async function answeredPathsQuestion(db: Db, token: string) {
  const [question] = await db.select().from(questions).where(eq(questions.id, token));
  return question && question.context.reason === "paths" && question.answer !== null ? question : undefined;
}

/**
 * Runs that gave up their worktree: a run that succeeded or was cancelled. A failed run keeps its
 * worktree, with what setup installed and what the failed attempt left, until a person repairs or
 * cancels it, or `handoff gc` removes it.
 */
const RELEASING_RUN = new Set(["succeeded", "cancelled"]);

const TEARDOWN_TIMEOUT_MS = 10 * 60_000;
/** Runs this process is releasing now, so a slow teardown never runs twice for one worktree. */
const releasing = new Set<string>();

type ReleaseDeps = Pick<EngineDeps, "db" | "workdirs" | "remoteUrl" | "log">;

/**
 * Runs the project's teardown command in the worktree, where the setup command ran, with the run's
 * identity, so it can drop what setup made for this run. Its result is an event; a failure never
 * keeps the worktree.
 */
async function tearDown(deps: ReleaseDeps, run: typeof runs.$inferSelect, project: typeof projects.$inferSelect, spec: WorkdirSpec) {
  const command = project.teardownCommand;
  if (!command || !run.worktreePath || !existsSync(run.worktreePath)) return;
  try {
    const workdir = await deps.workdirs.acquire(spec);
    const result = await shell(command, workdir.path, TEARDOWN_TIMEOUT_MS, workdir.container, [], undefined, runIdentity(run.id, workdir.path));
    const failed = result.exitCode !== 0 || result.timedOut;
    const payload = { command, exitCode: result.exitCode, timedOut: result.timedOut, ...(failed ? { output: result.output } : {}) };
    await deps.db.transaction((tx) => appendEvents(tx, run.id, [{ type: "teardown.finished", payload }]));
  } catch (error) {
    deps.log?.("teardown failed", { runId: run.id, error: String(error) });
  }
}

/**
 * Removes a run's worktree and forgets its path; the branch stays so a repair can re-create it. The
 * project's teardown command runs first. This is the one place a worktree is removed.
 */
export async function releaseWorktree(deps: ReleaseDeps, run: typeof runs.$inferSelect, project: typeof projects.$inferSelect) {
  if (releasing.has(run.id)) return false;
  releasing.add(run.id);
  const spec = { runId: run.id, remoteUrl: (deps.remoteUrl ?? defaultRemote)(project), baseBranch: run.baseBranch, branchName: run.branchName };
  try {
    await tearDown(deps, run, project, spec);
    await deps.workdirs.release(spec);
    await deps.db.update(runs).set({ worktreePath: null }).where(eq(runs.id, run.id));
    return true;
  } catch (error) {
    deps.log?.("workdir release failed", { runId: run.id, error: String(error) });
    return false;
  } finally {
    releasing.delete(run.id);
  }
}

async function releaseIfFinished(deps: EngineDeps, runId: string, project: typeof projects.$inferSelect) {
  const [run] = await deps.db.select().from(runs).where(eq(runs.id, runId));
  if (run && RELEASING_RUN.has(run.status)) await releaseWorktree(deps, run, project);
}

/** Worktrees of runs that ended without a step to release them, such as a failed run a person cancelled. */
async function releaseEnded(deps: EngineDeps) {
  const ended = await deps.db
    .select({ run: runs, project: projects })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(inArray(runs.status, [...RELEASING_RUN] as ("succeeded" | "cancelled")[]), isNotNull(runs.worktreePath)))
    .limit(10);
  for (const { run, project } of ended) await releaseWorktree(deps, run, project);
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
      const contract = await validateContract(node.contract, outcome.output, {
        state: { ...state, ...outcome.statePatch },
        baseBranch,
        workdir: workdir?.path,
        container: workdir?.container,
        nodeKey: row.nodeKey,
      });
      if (contract.passed) {
        await db.transaction((tx) =>
          completePassed(tx, { row, workerId, graph, output: contract.output, statePatch: outcome.statePatch, memory: outcome.memory, checks: contract.checks, cost: outcome.cost }),
        );
      } else if (contract.pathsOutside) {
        // Only files outside the plan are wrong: a person decides whether they belong to the change.
        const files = contract.pathsOutside;
        await db.transaction((tx) => askAboutPaths(tx, { row, workerId, graph, output: contract.output, checks: contract.checks, files, cost: outcome.cost }));
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
    case "failed": {
      const maxRetries = deps.maxRetries ?? 3;
      if (outcome.retryable && row.retryCount < maxRetries) {
        const delayMs = outcome.retryAfterMs ?? (deps.retryBackoffMs ?? 60_000) * 2 ** row.retryCount;
        await db.transaction((tx) => scheduleRetry(tx, { row, workerId, error: outcome.error, delayMs }));
        return;
      }
      if (await continuesAfterMaxTurns(row, node.type, outcome.error, workdir, baseBranch)) {
        const last = (outcome.error.detail as { lastMessage?: unknown } | undefined)?.lastMessage;
        const note = [CONTINUE_NOTE, ...(typeof last === "string" && last ? [`Its last message: ${last}`] : [])].join("\n\n");
        await db.transaction((tx) => failAndRetry(tx, { row, workerId, error: outcome.error, checks: [], note, reason: "continue", cost: outcome.cost }));
        return;
      }
      await db.transaction((tx) => completeFailed(tx, { row, workerId, graph, error: outcome.error, cost: outcome.cost }));
      return;
    }
    case "interrupted":
      await db.transaction((tx) => releaseForReclaim(tx, { row, workerId }));
      return;
  }
}
