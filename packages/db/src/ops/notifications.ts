import type { DbExecutor } from "../client.ts";
import { notifications, type NewNotification, type NotificationRow } from "../schema/index.ts";

/**
 * Tells a person something: stores the notification as its sender wrote it. Inside a transaction it
 * commits with what it is about, so a question never exists without its notification.
 */
export async function createNotification(db: DbExecutor, notification: Omit<NewNotification, "id" | "createdAt">): Promise<NotificationRow> {
  const [row] = await db.insert(notifications).values(notification).returning();
  return row!;
}
