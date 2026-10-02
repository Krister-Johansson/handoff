import { sql } from "drizzle-orm";
import { index, integer, jsonb, numeric, pgTable, text, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAt, id, tstz, updatedAt } from "./columns.ts";
import { executorKind, nodeExecutionStatus, waitKind } from "./enums.ts";
import { runs } from "./runs.ts";

export const nodeExecutions = pgTable(
  "node_executions",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    nodeKey: text("node_key").notNull(),
    nodeType: text("node_type").notNull(),
    executorKind: executorKind("executor_kind").notNull(),
    attempt: integer("attempt").notNull(),
    status: nodeExecutionStatus("status").notNull().default("pending"),
    runnableAt: tstz("runnable_at").notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: tstz("lease_expires_at"),
    heartbeatAt: tstz("heartbeat_at"),
    reclaimCount: integer("reclaim_count").notNull().default(0),
    interruptCount: integer("interrupt_count").notNull().default(0),
    /** Automatic retries after retryable failures such as rate limits. */
    retryCount: integer("retry_count").notNull().default(0),
    waitKind: waitKind("wait_kind"),
    waitKey: text("wait_key"),
    waitToken: uuid("wait_token").unique(),
    waitDeadlineAt: tstz("wait_deadline_at"),
    wakeRequestedAt: tstz("wake_requested_at"),
    wakeReason: text("wake_reason"),
    wakePayload: jsonb("wake_payload").$type<unknown[]>(),
    contextPacket: jsonb("context_packet").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<unknown>(),
    checks: jsonb("checks").$type<unknown[]>(),
    error: jsonb("error").$type<{ code: string; message: string; detail?: unknown }>(),
    executorSessionId: text("executor_session_id"),
    /** Process group of the running claude child, so a restarted worker can kill it. */
    childPid: integer("child_pid"),
    childHost: text("child_host"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    usage: jsonb("usage").$type<unknown>(),
    repairedFromExecutionId: uuid("repaired_from_execution_id").references((): AnyPgColumn => nodeExecutions.id),
    repairNote: text("repair_note"),
    /**
     * Why this execution exists: the edge that created it, or a repair, or a loop exhaustion. A repair the
     * engine started itself has a reason: files outside the plan sent back, or a continuation after running out of turns.
     */
    trigger: jsonb("trigger").$type<{ kind: "start" | "edge" | "exhausted" | "repair"; edgeKey?: string; from?: string; fromExecutionId?: string; reason?: "paths" | "continue" }>(),
    claimedAt: tstz("claimed_at"),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("node_executions_run_node_attempt_unique").on(t.runId, t.nodeKey, t.attempt),
    index("node_executions_claim_idx")
      .on(t.executorKind, t.runnableAt, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    index("node_executions_lease_idx")
      .on(t.leaseExpiresAt)
      .where(sql`${t.status} = 'running'`),
    index("node_executions_wait_deadline_idx")
      .on(t.waitDeadlineAt)
      .where(sql`${t.status} = 'waiting'`),
    index("node_executions_wait_key_idx")
      .on(t.waitKey)
      .where(sql`${t.status} in ('running', 'waiting')`),
    index("node_executions_run_idx").on(t.runId, t.createdAt),
  ],
);
