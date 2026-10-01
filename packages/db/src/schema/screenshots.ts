import { boolean, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.ts";
import { nodeExecutions } from "./node-executions.ts";
import { runs } from "./runs.ts";

/**
 * A screenshot a Demo step took of the run's app. The image stays a file in the worker's data folder,
 * at `path`; the dashboard serves it by id.
 */
export const screenshots = pgTable(
  "screenshots",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    nodeExecutionId: uuid("node_execution_id")
      .notNull()
      .references(() => nodeExecutions.id),
    /** Its place in the walk-through, from 0. */
    position: integer("position").notNull(),
    path: text("path").notNull(),
    caption: text("caption").notNull(),
    /** The acceptance criterion it shows, if any, and whether that criterion works. */
    criterion: text("criterion"),
    works: boolean("works"),
    createdAt: createdAt(),
  },
  (t) => [index("screenshots_run_idx").on(t.runId)],
);
