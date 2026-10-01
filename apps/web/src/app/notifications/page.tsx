import Link from "next/link";
import { CheckCheckIcon } from "lucide-react";
import { notificationsHref, parseNotificationFilter } from "@/components/notifications/filters";
import { NotificationFeed, NotificationFilters } from "@/components/notifications/notification-feed";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { listNotifications } from "@/server/notifications";
import { markAllReadAction } from "./actions";

export const dynamic = "force-dynamic";

const PAGE = 50;

/** Every notification, newest first and grouped by day, a page at a time, narrowed to unread items or one kind. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ before?: string; show?: string | string[] }> }) {
  const { before, show } = await searchParams;
  const filter = parseNotificationFilter(show);
  const from = before ? new Date(before) : undefined;
  const { items, unread } = await listNotifications(getDb(), { limit: PAGE, ...(from && !Number.isNaN(from.getTime()) ? { before: from } : {}), ...(filter ? { filter } : {}) });
  const oldest = items.at(-1);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[{ label: "Notifications" }]}
        title="Notifications"
        description="What happened in your runs, newest first. Items that need you also wait in the inbox until you act on them."
        actions={
          <>
            <NotificationFilters current={filter} unread={unread} />
            {unread > 0 && (
              <form action={markAllReadAction}>
                <Button type="submit" variant="outline">
                  <CheckCheckIcon data-icon="inline-start" />
                  Mark all read
                </Button>
              </form>
            )}
          </>
        }
      />
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{before ? "Nothing older" : filter ? "Nothing here" : "No notifications yet"}</EmptyTitle>
            <EmptyDescription>{filter ? "No notification matches this filter." : "Start a run from a project to see it here."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <section aria-label="Notifications" className="overflow-hidden rounded-xl bg-card text-sm ring-1 ring-border">
          <NotificationFeed items={items} />
          {items.length === PAGE && oldest && (
            <div className="flex justify-center border-t p-2">
              <Button variant="ghost" size="sm" asChild>
                <Link href={notificationsHref(filter, oldest.createdAt.toISOString())}>Older</Link>
              </Button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
