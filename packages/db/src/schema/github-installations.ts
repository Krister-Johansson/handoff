import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id, tstz, updatedAt } from "./columns.ts";

export const githubInstallations = pgTable("github_installations", {
  id: id(),
  installationId: bigint("installation_id", { mode: "number" }).notNull().unique(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(),
  suspendedAt: tstz("suspended_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
