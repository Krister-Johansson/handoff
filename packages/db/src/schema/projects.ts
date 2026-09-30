import { bigint, boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns.ts";
import { githubInstallations } from "./github-installations.ts";

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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
