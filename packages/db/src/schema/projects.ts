import { bigint, boolean, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns.ts";
import { githubInstallations } from "./github-installations.ts";

export type ProjectLibrary = { skills: string[]; mcp: string[]; agents: string[]; groups: string[] };

export const projects = pgTable("projects", {
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
  /** The number of the repository owner's GitHub Project (v2) that holds this project's plan; null without a plan. */
  planProjectNumber: integer("plan_project_number"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
