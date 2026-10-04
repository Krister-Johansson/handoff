import { index, integer, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tstz } from "./columns.ts";
import { projects } from "./projects.ts";

export const launchTestStatus = pgEnum("launch_test_status", ["starting", "ready", "failed", "stopped"]);
export type LaunchTestStatus = (typeof launchTestStatus.enumValues)[number];

/** The steps of a Test start, in the order they run. */
export const LAUNCH_TEST_STEPS = ["worktree", "setup", "services", "seed", "app"] as const;
export type LaunchTestStepName = (typeof LAUNCH_TEST_STEPS)[number];

/** One step of a Test start: what it did, and how long it took once it ended. */
export type LaunchTestStep = { name: LaunchTestStepName; status: "running" | "done" | "failed"; detail: string; ms: number | null };

/**
 * A Test start from Project settings, App launch: the project's app started from a fresh worktree of its
 * default branch, outside any run, to see that it starts. The dashboard owns the process; `pid` leads its
 * process group, the host's `docker exec` client in a Docker workspace. It stops when a person stops it, when another Test start of the project begins, or at
 * `stopsAt`.
 */
export const launchTests = pgTable(
  "launch_tests",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: launchTestStatus("status").notNull().default("starting"),
    /** The command line it starts, as the form or the file had it. */
    command: text("command").notNull(),
    steps: jsonb("steps").$type<LaunchTestStep[]>().notNull().default([]),
    worktreePath: text("worktree_path"),
    pid: integer("pid"),
    port: integer("port"),
    url: text("url"),
    /** Where the app's output goes: a file in the worktree's git directory, outside the tree. */
    logPath: text("log_path"),
    /**
     * In a Docker workspace, the app's container (handoff-preview-<id8>), written before it starts; the
     * setup command runs in the setup container handoff-<id>. Null in worktree mode.
     */
    container: text("container"),
    /** Why it did not start, in a sentence a person can act on. */
    error: text("error"),
    /** The end of the output that explains the failure: the app's log, or the setup or seed command's output. */
    log: text("log"),
    createdAt: createdAt(),
    readyAt: tstz("ready_at"),
    stopsAt: tstz("stops_at").notNull(),
    stoppedAt: tstz("stopped_at"),
  },
  (t) => [index("launch_tests_project_idx").on(t.projectId)],
);
