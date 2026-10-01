import { index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, tstz } from "./columns.ts";
import { nodeExecutions } from "./node-executions.ts";
import { runs } from "./runs.ts";

export const permissionStatus = pgEnum("permission_status", ["pending", "allowed", "denied", "expired"]);

/**
 * A tool call Claude Code wanted to make that the step's allow rules do not cover, waiting for a person
 * to allow or deny it while the step runs. Its id is the request the permission server wrote.
 */
export const permissionRequests = pgTable(
  "permission_requests",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    nodeExecutionId: uuid("node_execution_id")
      .notNull()
      .references(() => nodeExecutions.id),
    toolName: text("tool_name").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    status: permissionStatus("status").notNull().default("pending"),
    /** The allow rule the person added to the node, when they chose to always allow it. */
    rule: text("rule"),
    /** What the person told Claude when they denied it. */
    message: text("message"),
    decidedBy: text("decided_by"),
    decidedAt: tstz("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [index("permission_requests_execution_idx").on(t.nodeExecutionId, t.status), index("permission_requests_run_idx").on(t.runId)],
);
