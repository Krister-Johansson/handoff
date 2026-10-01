import Link from "next/link";
import { CheckCheckIcon } from "lucide-react";
import { NotificationList } from "@/components/notifications/notification-list";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { listNotifications } from "@/server/notifications";
import { markAllReadAction } from "./actions";

export const dynamic = "force-dynamic";

const PAGE = 50;

/** Every notification, newest first, a page at a time. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const from = before ? new Date(before) : undefined;
  const { items, unread } = await listNotifications(getDb(), { limit: PAGE, ...(from && !Number.isNaN(from.getTime()) ? { before: from } : {}) });
  const oldest = items.at(-1);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[{ label: "Notifications" }]}
        title="Notifications"
        description="Runs that started, finished or failed, and gates that asked for you, newest first. Things that wait on you are in the Inbox."
        actions={
          unread > 0 && (
            <form action={markAllReadAction}>
              <Button type="submit" variant="outline" size="sm">
                <CheckCheckIcon data-icon="inline-start" />
                Mark all as read
              </Button>
            </form>
          )
        }
      />
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{before ? "Nothing older" : "No notifications yet"}</EmptyTitle>
            <EmptyDescription>Start a run from a project to see it here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <NotificationList items={items} />
            {items.length === PAGE && oldest && (
              <Button variant="ghost" size="sm" className="self-center" asChild>
                <Link href={`/notifications?before=${encodeURIComponent(oldest.createdAt.toISOString())}`}>Older</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
