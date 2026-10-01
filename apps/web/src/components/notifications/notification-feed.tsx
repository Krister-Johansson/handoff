import Link from "next/link";
import { FilterLinks } from "@/components/filter-links";
import { formatAgo } from "@/lib/format";
import type { NotificationFilter } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { NOTIFICATION_FILTERS, notificationsHref } from "./filters";
import { KindTile, UnreadDot, type NotificationRow } from "./notification-list";

/** Links that narrow the feed: everything, the unread items, or one kind. */
export function NotificationFilters({ current, unread }: { current: NotificationFilter | undefined; unread: number }) {
  return (
    <FilterLinks
      label="Show"
      links={NOTIFICATION_FILTERS.map(({ filter, label }) => ({ label, href: notificationsHref(filter), current: filter === current, ...(filter === "unread" && unread > 0 ? { count: unread } : {}) }))}
    />
  );
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A day's heading: today, yesterday, how many days back within the week, then the date. */
function dayLabel(day: Date, now: Date) {
  const days = Math.round((startOfDay(now) - startOfDay(day)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return day.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(day.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Notifications newest first, under a heading per day, each with its kind's icon. The notifications page shows these. */
export function NotificationFeed({ items, now = new Date() }: { items: NotificationRow[]; now?: Date }) {
  const days: { label: string; items: (NotificationRow & { at: Date })[] }[] = [];
  for (const item of items) {
    const at = new Date(item.createdAt);
    const label = dayLabel(at, now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push({ ...item, at });
    else days.push({ label, items: [{ ...item, at }] });
  }
  return (
    <div className="flex flex-col">
      {days.map((day, i) => (
        <div key={day.label} role="group" aria-label={day.label} className={cn(i > 0 && "border-t")}>
          <div className="px-5 pt-3.5 pb-1.5 text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">{day.label}</div>
          <ul>
            {day.items.map((item) => (
              <li key={item.id} className="border-t">
                <Link
                  href={item.href}
                  className={cn("grid grid-cols-[8px_28px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 hover:bg-muted", item.unread && "bg-active-bg/45 hover:bg-active-bg")}
                >
                  <UnreadDot unread={item.unread} />
                  <KindTile kind={item.kind} />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{item.title}</span>
                    <span className="mt-px truncate text-xs text-muted-foreground">{item.body}</span>
                  </span>
                  <span className="text-xs whitespace-nowrap text-muted-foreground" title={item.at.toISOString()}>
                    {day.label === "Today" ? formatAgo(item.at, now) : clock(item.at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
