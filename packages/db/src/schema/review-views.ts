import { pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, tstz } from "./columns.ts";
import { runs } from "./runs.ts";

/**
 * A person marked a file viewed in a code review. The blob id ties the mark to that version of the
 * file, so a later round shows the file as viewed only while the coder has not changed it.
 */
export const reviewViews = pgTable(
  "review_views",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    path: text("path").notNull(),
    blobSha: text("blob_sha").notNull(),
    viewedAt: tstz("viewed_at").notNull().defaultNow(),
  },
  (t) => [unique("review_views_run_path_blob_unique").on(t.runId, t.path, t.blobSha)],
);
