import { bigint, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tstz, updatedAt } from "./columns.ts";
import { runStatus } from "./enums.ts";
import { graphVersions } from "./graphs.ts";
import { projects } from "./projects.ts";

export const runs = pgTable(
  "runs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    graphVersionId: uuid("graph_version_id")
      .notNull()
      .references(() => graphVersions.id),
    status: runStatus("status").notNull().default("queued"),
    task: text("task").notNull(),
    // Typed as RunState from @handoff/core once it exists (M1).
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    stateVersion: integer("state_version").notNull().default(0),
    nextEventSeq: bigint("next_event_seq", { mode: "number" }).notNull().default(0),
    baseBranch: text("base_branch").notNull(),
    branchName: text("branch_name").notNull(),
    worktreePath: text("worktree_path"),
    prNumber: integer("pr_number"),
    /** GitHub issues the run works on; the bodies live in run state for the agents. */
    issues: jsonb("issues").$type<{ number: number; title: string; url: string }[]>().notNull().default([]),
    cancelRequestedAt: tstz("cancel_requested_at"),
    /** When the run's pull request joined its project's merge queue; the queue merges in this order. */
    mergeQueuedAt: tstz("merge_queued_at"),
    /** When a person asked to merge it (manual merging); auto merging needs no request. */
    mergeRequestedAt: tstz("merge_requested_at"),
    /** Set when the user archives a finished run; hides its pull request from the dashboard's lists. */
    archivedAt: tstz("archived_at"),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("runs_project_created_idx").on(t.projectId, t.createdAt.desc()), index("runs_status_idx").on(t.status)],
);
