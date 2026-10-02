import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, tstz, updatedAt } from "./columns.ts";
import { projects } from "./projects.ts";

/**
 * A project's scheduler: its settings and the state of its checks. The scheduler starts runs on the
 * plan's Ready tasks on its own while it is on and not paused. A row exists once someone turns it on.
 */
export const projectSchedulers = pgTable(
  "project_schedulers",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    /** The most runs of the project active at once, whoever started them. */
    maxRuns: integer("max_runs").notNull().default(1),
    /** "project" for Project order, "priority" for the Priority field first. */
    order: text("order").$type<"project" | "priority">().notNull().default("project"),
    /** The graph the scheduler's runs use. */
    graphName: text("graph_name").notNull(),
    /** Tasks with this label are left to a person; null skips none. */
    skipLabel: text("skip_label").default("human"),
    pausedAt: tstz("paused_at"),
    /** "person" or "scheduler", when the scheduler paused itself after failed starts. */
    pausedBy: text("paused_by"),
    pauseReason: text("pause_reason"),
    nextCheckAt: tstz("next_check_at").notNull().defaultNow(),
    lastCheckAt: tstz("last_check_at"),
    /** The worker checking the project now; a check holds the lease until it ends or the lease expires. */
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: tstz("lease_expires_at"),
    /** Failed starts in a row; three pause the scheduler. A refusal of one task is not a failure. */
    startFailures: integer("start_failures").notNull().default(0),
    /** What the last check found: its state, the holds and the candidates in order, for the status reads. */
    lastResult: jsonb("last_result").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("project_schedulers_max_runs_check", sql`${t.maxRuns} between 1 and 10`),
    check("project_schedulers_order_check", sql`${t.order} in ('project', 'priority')`),
    index("project_schedulers_due_idx")
      .on(t.nextCheckAt)
      .where(sql`${t.enabled} and ${t.pausedAt} is null`),
  ],
);

/** What a project's scheduler did and why, newest last. Run events need a run; these belong to the project. */
export const schedulerEvents = pgTable(
  "scheduler_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("scheduler_events_project_created_idx").on(t.projectId, t.createdAt.desc())],
);

export type ProjectSchedulerRow = typeof projectSchedulers.$inferSelect;
export type SchedulerEventRow = typeof schedulerEvents.$inferSelect;
