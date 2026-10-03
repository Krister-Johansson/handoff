import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tstz } from "./columns.ts";
import { nodeExecutions } from "./node-executions.ts";
import { runs } from "./runs.ts";

/**
 * A comment a person made on a quoted part, or on lines of a file, of what they reviewed. `author` is
 * set on a code reviewer's finding the person sent back with their answer: the reviewing step's key.
 */
export type QuestionComment = { quote?: string; body: string; path?: string; line?: number; endLine?: number; side?: "old" | "new"; author?: string };

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
    /** Comments on quoted parts of what the gate showed for review, sent back with the answer. */
    comments: jsonb("comments").$type<QuestionComment[]>().notNull().default([]),
    /**
     * The code reviewer's findings the person kept on Fix now, by their place in the review from 0.
     * Null when the question shows no code review findings. Later steps get only these as suggestions.
     */
    findings: jsonb("findings").$type<number[]>(),
    answeredBy: text("answered_by"),
    answeredAt: tstz("answered_at"),
    createdAt: createdAt(),
  },
  (t) => [index("questions_run_idx").on(t.runId)],
);
