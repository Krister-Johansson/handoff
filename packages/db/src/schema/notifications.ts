import { index, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.ts";
import { projects } from "./projects.ts";
import { runs } from "./runs.ts";

/** How a notification looks and sounds: plain news, something that went well, something that waits for a person, or something that went wrong. */
export const notificationTone = pgEnum("notification_tone", ["neutral", "success", "attention", "danger"]);

/**
 * Something a person is told. Whoever sends it writes the title, the body and the link, and the feed
 * shows them as they are. It refers to nothing it is about: a question and its notification are two
 * rows. The project and the run are kept only to leave the demo project out and to delete with them.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    projectId: uuid("project_id").references(() => projects.id),
    runId: uuid("run_id").references(() => runs.id),
    tone: notificationTone("tone").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** A dashboard path. A notification without one is not a link. */
    href: text("href"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_created_idx").on(t.createdAt), index("notifications_run_idx").on(t.runId), index("notifications_project_idx").on(t.projectId)],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
