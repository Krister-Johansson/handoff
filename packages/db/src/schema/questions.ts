import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tstz } from "./columns.ts";
import { nodeExecutions } from "./node-executions.ts";
import { runs } from "./runs.ts";

/** A question for a person, asked by a Human gate. Its id is the gate execution's wait token. */
export const questions = pgTable(
  "questions",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    nodeExecutionId: uuid("node_execution_id")
      .notNull()
      .unique()
      .references(() => nodeExecutions.id),
    question: text("question").notNull(),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    answer: text("answer"),
    option: text("option"),
    answeredBy: text("answered_by"),
    answeredAt: tstz("answered_at"),
    createdAt: createdAt(),
  },
  (t) => [index("questions_run_idx").on(t.runId)],
);
