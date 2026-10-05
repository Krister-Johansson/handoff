import { sql } from "drizzle-orm";
import { bigint, boolean, check, integer, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns.ts";
import { githubInstallations } from "./github-installations.ts";

export type ProjectLibrary = { skills: string[]; mcp: string[]; agents: string[]; groups: string[] };

/** One configuration of a .claude/launch.json, as @handoff/core's LaunchConfigurationSchema reads it. */
export type ProjectLaunch = {
  name: string;
  runtimeExecutable?: string;
  runtimeArgs: string[];
  program?: string;
  args: string[];
  port: number;
  cwd?: string;
  env: Record<string, string>;
  autoPort?: boolean;
  url?: string;
};

/** How a project plans its work: Flow orders tasks without dates; Timeline gives them dates and estimates. */
export const PLAN_MODES = ["flow", "timeline"] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

export const projects = pgTable(
  "projects",
  {
    id: id(),
    name: text("name").notNull().unique(),
    githubInstallationId: uuid("github_installation_id").references(() => githubInstallations.id),
    repoId: bigint("repo_id", { mode: "number" }).unique(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    localClonePath: text("local_clone_path"),
    /** Seeded by pnpm demo; points at no real repository. */
    isDemo: boolean("is_demo").notNull().default(false),
    /** Library entries by name that every CLI node of every run in this project gets. Names only, never secrets. */
    library: jsonb("library").$type<ProjectLibrary>().notNull().default({ skills: [], mcp: [], agents: [], groups: [] }),
    /** A command run once in each run's worktree before its first step there, such as installing dependencies. */
    setupCommand: text("setup_command"),
    /** A command run in a run's worktree just before handoff removes it, to drop what the setup command made. */
    teardownCommand: text("teardown_command"),
    /** A command run in a run's worktree after the app's compose services start and before the app, for a Demo step: seeds data to show. */
    demoSeedCommand: text("demo_seed_command"),
    /**
     * How a run's app starts when the repository has no .claude/launch.json: one configuration of that file,
     * set in Project settings, App launch. The file wins when there is one. Plain text; never secrets.
     */
    launch: jsonb("launch").$type<ProjectLaunch>(),
    /** Globs of the files a person sees in the app. A Demo step set to UI changes skips a change that touches none. Null: the defaults. */
    uiPaths: text("ui_paths").array(),
    /** The most files and steps a planner's plan may have before it proposes a split. Null: the defaults, 15 files and 12 steps. */
    planBudget: jsonb("plan_budget").$type<{ files: number; steps: number }>(),
    /** Free text every agent step reads under "About this project's environment". Never secrets. */
    agentNotes: text("agent_notes"),
    /** The number of the repository owner's GitHub Project (v2) that holds this project's plan; null without a plan. */
    planProjectNumber: integer("plan_project_number"),
    /** The person's hours of work a day on the plan's timeline: a task's duration over it gives its bar in days. */
    planHoursPerDay: numeric("plan_hours_per_day", { precision: 4, scale: 1, mode: "number" }).notNull().default(6),
    /**
     * Flow or Timeline. Only a person changes it, in Project settings. Projects that existed before the column
     * plan in Timeline; a project added after it starts in Flow.
     */
    planMode: text("plan_mode").$type<PlanMode>().notNull().default("flow"),
    /** How long a step waits for an answer to a permission request before it is denied and the step goes on, in minutes. */
    permissionTimeoutMinutes: integer("permission_timeout_minutes").notNull().default(10),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("projects_plan_hours_per_day_check", sql`${t.planHoursPerDay} between 1 and 24`),
    check("projects_plan_mode_check", sql`${t.planMode} in ('flow', 'timeline')`),
    check("projects_permission_timeout_minutes_check", sql`${t.permissionTimeoutMinutes} between 1 and 120`),
  ],
);
