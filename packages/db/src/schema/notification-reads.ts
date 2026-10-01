import { sql } from "drizzle-orm";
import { check, integer, pgTable } from "drizzle-orm/pg-core";
import { tstz } from "./columns.ts";

/**
 * How far the person has read the notification feed: one row, moved forward when they open the bell.
 * The dashboard has one user, so one watermark is the whole read state.
 */
export const notificationReads = pgTable(
  "notification_reads",
  {
    id: integer("id").primaryKey().default(1),
    readUntil: tstz("read_until").notNull(),
  },
  (t) => [check("notification_reads_single_row", sql`${t.id} = 1`)],
);
