"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon, BellRingIcon } from "lucide-react";
import { toast } from "sonner";
import { NotificationList } from "@/components/notifications/notification-list";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { titleWithCount } from "@/lib/attention";
import type { NotificationJson } from "@/lib/notifications";
import { notify } from "@/lib/notify";

type Feed = { items: NotificationJson[]; unread: number };

const fetchFeed = async (): Promise<Feed> => {
  const res = await fetch("/api/notifications", { cache: "no-store" });
  if (!res.ok) throw new Error(`notifications: ${res.status}`);
  return (await res.json()) as Feed;
};

const postRead = async (until: string) => {
  await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ until }) });
};

const label = (n: number) => (n === 0 ? "No unread notifications" : `${n} unread notification${n === 1 ? "" : "s"}`);

/** More new notifications than this at once make one toast instead of one each. */
const TOAST_LIMIT = 3;

/** Shows one new notification as a toast: a start quietly, a question or a failure for longer. */
function toastFor(item: NotificationJson, open: (href: string) => void) {
  const options = { description: item.body, action: { label: "Open", onClick: () => open(item.href) } };
  if (item.kind === "finished") toast.success(item.title, options);
  else if (item.kind === "failed") toast.error(item.title, { ...options, duration: 10_000 });
  else if (item.kind === "input") toast.warning(item.title, { ...options, duration: 10_000 });
  else toast.info(item.title, options);
}

/**
 * The header bell. It polls the notification feed, toasts what arrives while the page is open (and,
 * as chosen in settings, notifies the desktop and pings for what needs a person or ended), keeps the
 * unread count in the tab title, and marks the feed read when opened.
 */
export function NotificationBell({
  load = fetchFeed,
  markRead = postRead,
  intervalMs = 15_000,
}: {
  load?: () => Promise<Feed>;
  markRead?: (until: string) => Promise<unknown>;
  intervalMs?: number;
}) {
  const [feed, setFeed] = useState<Feed>({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    // What the feed held when the page opened is not news; only what arrives after that is.
    let seen: Set<string> | undefined;
    const go = (href: string) => window.location.assign(href);
    const tick = async () => {
      let next: Feed;
      try {
        next = await load();
      } catch {
        return;
      }
      if (cancelled) return;
      const fresh = seen ? next.items.filter((item) => item.unread && !seen!.has(item.id)) : [];
      seen = new Set([...(seen ?? []), ...next.items.map((item) => item.id)]);
      if (fresh.length > TOAST_LIMIT) toast.info(`${fresh.length} new notifications`, { action: { label: "Open", onClick: () => go("/notifications") } });
      else for (const item of fresh) toastFor(item, go);
      const urgent = fresh.filter((item) => item.kind !== "started");
      if (urgent.length) notify(urgent);
      setFeed(next);
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load, intervalMs]);

  useEffect(() => {
    document.title = titleWithCount(document.title, feed.unread);
  }, [feed.unread, pathname]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    const newest = feed.items[0];
    if (!next || !newest || feed.unread === 0) return;
    // The dots stay while the bell is open, so the person sees what was new.
    setFeed((f) => ({ ...f, unread: 0 }));
    void markRead(newest.createdAt);
  };

  const Icon = feed.unread ? BellRingIcon : BellIcon;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className="relative text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground" aria-label={label(feed.unread)}>
          <Icon />
          {feed.unread > 0 && (
            <span className="absolute -top-0.5 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-dot px-1 text-[10px] font-semibold text-white tabular-nums">
              {feed.unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-96 flex-col gap-2 p-2">
        <h2 className="px-2 pt-1 text-sm font-medium">Notifications</h2>
        {feed.items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">No notifications yet. Runs that start, finish, fail or need you show up here.</p>
        ) : (
          <NotificationList items={feed.items} onNavigate={() => setOpen(false)} />
        )}
        <Separator />
        <Link href="/notifications" onClick={() => setOpen(false)} className="px-2 pb-1 text-xs text-muted-foreground hover:underline">
          All notifications
        </Link>
      </PopoverContent>
    </Popover>
  );
}
