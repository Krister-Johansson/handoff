import { index, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tstz } from "./columns.ts";
import { nodeExecutions } from "./node-executions.ts";
import { runs } from "./runs.ts";

export const previewStatus = pgEnum("preview_status", ["starting", "running", "stopped", "failed"]);

/**
 * A run's app, started from its worktree so a person can try it or an agent can take screenshots. The
 * worker that started it owns the process; `pid` leads its process group, so another worker can stop it.
 */
export const previews = pgTable(
  "previews",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    /** The step that asked for it; the preview stops when that step is done with it. */
    nodeExecutionId: uuid("node_execution_id").references(() => nodeExecutions.id),
    /** The launch configuration's name. */
    configuration: text("configuration").notNull(),
    workerId: text("worker_id").notNull(),
    status: previewStatus("status").notNull().default("starting"),
    pid: integer("pid"),
    port: integer("port").notNull(),
    url: text("url").notNull(),
    /** Where the app's output goes: a file in the worktree's git directory, outside the tree. */
    logPath: text("log_path").notNull(),
    error: text("error"),
    createdAt: createdAt(),
    stoppedAt: tstz("stopped_at"),
  },
  (t) => [index("previews_run_idx").on(t.runId), index("previews_worker_status_idx").on(t.workerId, t.status)],
);
