import { sql } from "drizzle-orm";
import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.ts";
import { nodeExecutions } from "./node-executions.ts";
import { runs } from "./runs.ts";

export const edgeTraversals = pgTable(
  "edge_traversals",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    edgeKey: text("edge_key").notNull(),
    fromExecutionId: uuid("from_execution_id")
      .notNull()
      .references(() => nodeExecutions.id),
    toNodeKey: text("to_node_key").notNull(),
    consumedByExecutionId: uuid("consumed_by_execution_id").references(() => nodeExecutions.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("edge_traversals_unconsumed_idx")
      .on(t.runId, t.toNodeKey)
      .where(sql`${t.consumedByExecutionId} is null`),
  ],
);
