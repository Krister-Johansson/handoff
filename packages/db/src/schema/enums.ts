import { pgEnum } from "drizzle-orm/pg-core";

export const runStatus = pgEnum("run_status", ["queued", "running", "waiting", "succeeded", "failed", "cancelled"]);
export const nodeExecutionStatus = pgEnum("node_execution_status", [
  "pending",
  "running",
  "waiting",
  "passed",
  "failed",
  "repaired",
]);
export const executorKind = pgEnum("executor_kind", ["cli", "shell", "github", "human", "function"]);
export const waitKind = pgEnum("wait_kind", ["github_pr", "human", "timer"]);
