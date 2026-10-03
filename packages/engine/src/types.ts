import type { Told } from "./notify.ts";
import type { CompiledGraph, CompiledNode, ContextPacket, NodeMemory, NodeType, NotifyKind, RunState } from "@handoff/core";
import type { NodeExecutionRow, projects, runs } from "@handoff/db";
import type { MaterializedLibrary } from "./library/materialize.ts";

export type RunRow = typeof runs.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;

/**
 * `startFrom` is the branch a new run branch starts at instead of the base branch: the branch of the run it
 * continues. `detached` checks out the base branch's head with no branch of its own, for a worktree that
 * makes no commits, such as a Test start's; `branchName` is then unused.
 */
export type WorkdirSpec = { runId: string; remoteUrl: string; baseBranch: string; branchName: string; startFrom?: string; detached?: boolean };
/** Where a run's code lives. `container` is set when commands must run inside a Docker container. */
export type Workdir = { path: string; baseSha: string; container?: string };

/** Where a run's code lives. Git worktrees today; a Docker implementation later (M6). */
export interface WorkdirProvider {
  acquire(spec: WorkdirSpec): Promise<Workdir>;
  release(spec: WorkdirSpec): Promise<void>;
  /**
   * Moves a worktree whose branch has no commits of its own to the base branch's latest commit.
   * Returns the commits it moved from and to, or nothing when the branch has commits or is current.
   */
  fastForward?(spec: WorkdirSpec): Promise<{ from: string; to: string } | undefined>;
}

export type ExecutorContext = {
  run: RunRow;
  project: ProjectRow;
  execution: NodeExecutionRow;
  node: CompiledNode;
  graph: CompiledGraph;
  state: RunState;
  packet: ContextPacket;
  workdir?: Workdir;
  stagingDir: string;
  /** Library entries staged for this execution (cli nodes). */
  library?: MaterializedLibrary;
  signal: AbortSignal;
  emit(type: string, payload: unknown): void;
  /** Tells a person about `kind`, when this node's settings have it on. The executor writes the text and the link. */
  notify(kind: NotifyKind, told: Told): Promise<void>;
  setSessionId(id: string): Promise<void>;
  /** Stores the GitHub repository id on the project so later lookups are free. */
  recordRepoId(repoId: number): Promise<void>;
  /** Stores the run's pull request number as soon as the PR exists, before the PR node passes. */
  recordPrNumber(prNumber: number): Promise<void>;
  /** Records the running child process so a restarted worker can stop it. */
  setChildPid(pid: number): Promise<void>;
  /** Records the correlation key while still running so a wake that arrives before the yield is kept. */
  registerWait(key: string): Promise<void>;
};

export type ExecutionError = { code: string; message: string; detail?: unknown };

export type ExecutorOutcome =
  | {
      kind: "completed";
      output: unknown;
      statePatch?: Record<string, unknown>;
      /** Additions to nodes' memory by node key, appended to the run's current state when the step completes. */
      memory?: Record<string, Partial<NodeMemory>>;
      cost?: { usd?: number | undefined; usage?: unknown };
    }
  | { kind: "waiting"; wait: { kind: "github_pr" | "human" | "timer" | "merge_queue"; key?: string; token?: string; deadlineAt?: Date } }
  | { kind: "failed"; error: ExecutionError; retryable?: boolean; retryAfterMs?: number; cost?: { usd?: number | undefined; usage?: unknown } }
  | { kind: "interrupted" };

export interface NodeExecutor {
  /** Whether the step runs in the run's worktree; a function decides by the node, as a Try it gate needs one and other gates do not. */
  needsWorkdir: boolean | ((node: CompiledNode) => boolean);
  execute(ctx: ExecutorContext): Promise<ExecutorOutcome>;
}

export type ExecutorRegistry = Partial<Record<NodeType, NodeExecutor>>;
