import { and, desc, eq, notificationReads, notifications, projects, sql, type Db } from "@handoff/db";
import type { NotificationFilter, NotificationItem } from "../lib/notifications";

// Postgres keeps microseconds and a JS Date milliseconds; compare at milliseconds so a time read back marks its own item.
const ms = sql`date_trunc('milliseconds', ${notifications.createdAt})`;

/** Notifications of real projects and those about no project. The demo project's stay out. */
const shown = sql`coalesce(${projects.isDemo}, false) = false`;

async function readUntil(db: Db) {
  const [row] = await db.select({ readUntil: notificationReads.readUntil }).from(notificationReads);
  return row?.readUntil;
}

/**
 * The notification feed, newest first: what senders told a person, each with the tone, title, body and
 * link its sender wrote. The feed adds nothing to them. An item is unread when it came after the person
 * last opened the feed. `before` pages back from a time, and `filter` narrows to the unread items or to
 * one tone.
 */
export async function listNotifications(db: Db, { limit, before, filter }: { limit: number; before?: Date; filter?: NotificationFilter }): Promise<{ items: NotificationItem[]; unread: number }> {
  const until = await readUntil(db);
  const rows = await db
    .select({ id: notifications.id, tone: notifications.tone, title: notifications.title, body: notifications.body, href: notifications.href, createdAt: notifications.createdAt })
    .from(notifications)
    .leftJoin(projects, eq(projects.id, notifications.projectId))
    .where(
      and(
        shown,
        filter && filter !== "unread" ? eq(notifications.tone, filter) : undefined,
        before ? sql`${ms} < ${before}` : undefined,
        filter === "unread" && until ? sql`${ms} > ${until}` : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
  return { items: rows.map((row) => ({ ...row, unread: !until || row.createdAt.getTime() > until.getTime() })), unread: await unreadCount(db, until) };
}

/** How many notifications came after the watermark, all of them when the feed was never opened. */
async function unreadCount(db: Db, until: Date | undefined) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .leftJoin(projects, eq(projects.id, notifications.projectId))
    .where(and(shown, until ? sql`${ms} > ${until}` : undefined));
  return row?.n ?? 0;
}

/** Marks everything up to `until` as read. The watermark only moves forward. */
export async function markNotificationsRead(db: Db, until: Date) {
  await db
    .insert(notificationReads)
    .values({ id: 1, readUntil: until })
    .onConflictDoUpdate({ target: notificationReads.id, set: { readUntil: sql`greatest(${notificationReads.readUntil}, excluded.read_until)` } });
}
