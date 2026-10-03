import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./columns.ts";
import { projects } from "./projects.ts";

/** Why a task is pinned: a person dropped its card, picked Keep it here, or an agent's set_order pinned it. */
export const PIN_REASONS = ["drop", "keep_here", "set_order"] as const;
export type PinReason = (typeof PIN_REASONS)[number];

/**
 * Tasks pinned to their place in a Flow project's order, one row per task. GitHub Projects has no field for
 * a pin, so handoff keeps them. Every order operation puts a pinned task back at its place number; Optimize
 * and arrange_plan never pin or unpin. A pin ends when its task's run starts.
 */
export const planPins = pgTable(
  "plan_pins",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The task's issue number in the project's repository. */
    issue: integer("issue").notNull(),
    /** "person" from the dashboard, or the actor of set_order. */
    pinnedBy: text("pinned_by").notNull(),
    reason: text("reason").$type<PinReason>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.issue] }), check("plan_pins_reason_check", sql`${t.reason} in ('drop', 'keep_here', 'set_order')`)],
);

export type PlanPinRow = typeof planPins.$inferSelect;
