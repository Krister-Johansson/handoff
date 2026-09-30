import type { CompiledGraph, CompiledNode, ContextPacket, NodeType, RunState } from "@handoff/core";
import type { NodeExecutionRow, projects, runs } from "@handoff/db";
import type { MaterializedLibrary } from "./library/materialize.ts";

export type RunRow = typeof runs.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;

export type WorkdirSpec = { runId: string; remoteUrl: string; baseBranch: string; branchName: string };
/** Where a run's code lives. `container` is set when commands must run inside a Docker container. */
export type Workdir = { path: string; baseSha: string; container?: string };

/** Where a run's code lives. Git worktrees today; a Docker implementation later (M6). */
export interface WorkdirProvider {
  acquire(spec: WorkdirSpec): Promise<Workdir>;
  release(spec: WorkdirSpec): Promise<void>;
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
  setSessionId(id: string): Promise<void>;
  /** Records the correlation key while still running so a wake that arrives before the yield is kept. */
  registerWait(key: string): Promise<void>;
};

export type ExecutionError = { code: string; message: string; detail?: unknown };

export type ExecutorOutcome =
  | { kind: "completed"; output: unknown; statePatch?: Record<string, unknown>; cost?: { usd?: number | undefined; usage?: unknown } }
  | { kind: "waiting"; wait: { kind: "github_pr" | "human" | "timer"; key?: string; token?: string; deadlineAt?: Date } }
  | { kind: "failed"; error: ExecutionError; retryable?: boolean }
  | { kind: "interrupted" };

export interface NodeExecutor {
  needsWorkdir: boolean;
  execute(ctx: ExecutorContext): Promise<ExecutorOutcome>;
}

export type ExecutorRegistry = Partial<Record<NodeType, NodeExecutor>>;
