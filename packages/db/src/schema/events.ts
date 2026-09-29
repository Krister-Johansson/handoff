import { bigint, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./columns.ts";
import { nodeExecutions } from "./node-executions.ts";
import { runs } from "./runs.ts";

export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    // Per-run, gap-free sequence allocated from runs.next_event_seq under the run row lock.
    seq: bigint("seq", { mode: "number" }).notNull(),
    nodeExecutionId: uuid("node_execution_id").references(() => nodeExecutions.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("events_run_seq_unique").on(t.runId, t.seq)],
);
