import type { NotificationFilter } from "@/lib/notifications";

/** The feed's filters in the order the page shows them; no filter shows everything. */
export const NOTIFICATION_FILTERS: { filter: NotificationFilter | undefined; label: string }[] = [
  { filter: undefined, label: "All" },
  { filter: "unread", label: "Unread" },
  { filter: "input", label: "Needs you" },
  { filter: "finished", label: "Finished" },
  { filter: "failed", label: "Failed" },
];

/** The feed filter named in the address, if it is one the feed knows. */
export function parseNotificationFilter(show: string | string[] | undefined): NotificationFilter | undefined {
  return NOTIFICATION_FILTERS.find((f) => f.filter !== undefined && f.filter === show)?.filter;
}

/** The address of the feed narrowed to a filter, paging back from `before` when given. */
export function notificationsHref(filter: NotificationFilter | undefined, before?: string) {
  const params = new URLSearchParams();
  if (filter) params.set("show", filter);
  if (before) params.set("before", before);
  const query = params.toString();
  return query ? `/notifications?${query}` : "/notifications";
}
