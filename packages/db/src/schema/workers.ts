import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { tstz } from "./columns.ts";

export const workers = pgTable("workers", {
  id: text("id").primaryKey(),
  hostname: text("hostname").notNull(),
  caps: jsonb("caps").$type<Record<string, number>>().notNull(),
  startedAt: tstz("started_at").notNull().defaultNow(),
  heartbeatAt: tstz("heartbeat_at").notNull().defaultNow(),
  stoppedAt: tstz("stopped_at"),
});
