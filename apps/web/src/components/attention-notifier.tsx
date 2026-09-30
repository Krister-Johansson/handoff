"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon, BellRingIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { readPrefs, readSeen, titleWithCount, writePrefs, writeSeen, type AttentionItem, type NotifyPrefs } from "@/lib/attention";
import { playPing } from "@/lib/ping";

const fetchAttention = async (): Promise<AttentionItem[]> => {
  const res = await fetch("/api/attention", { cache: "no-store" });
  if (!res.ok) throw new Error(`attention: ${res.status}`);
  return ((await res.json()) as { items: AttentionItem[] }).items;
};

const hasNotifications = () => typeof Notification !== "undefined";

function notify(items: AttentionItem[]) {
  const prefs = readPrefs();
  if (prefs.sound) playPing();
  if (!prefs.desktop || !hasNotifications() || Notification.permission !== "granted") return;
  for (const item of items) {
    const notification = new Notification(item.title, { body: item.body, tag: item.id });
    notification.onclick = () => {
      window.focus();
      window.location.assign(item.href);
    };
  }
}

const label = (n: number) => (n === 0 ? "Nothing needs your attention" : `${n} ${n === 1 ? "thing needs" : "things need"} your attention`);

function Settings() {
  const [prefs, setPrefs] = useState<NotifyPrefs>(readPrefs);
  const [blocked, setBlocked] = useState(() => hasNotifications() && Notification.permission === "denied");
  const update = (next: NotifyPrefs) => {
    setPrefs(next);
    writePrefs(next);
  };
  const setDesktop = async (on: boolean) => {
    if (on && hasNotifications() && Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      setBlocked(permission !== "granted");
      if (permission !== "granted") return;
    }
    update({ ...prefs, desktop: on });
  };
  const test = () => notify([{ id: `test:${Date.now()}`, kind: "question", title: "handoff notifications work", body: "You will see one like this when a run needs you.", href: window.location.pathname }]);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="notify-desktop">Desktop notifications</Label>
        <Switch id="notify-desktop" checked={prefs.desktop} disabled={!hasNotifications()} onCheckedChange={(on) => void setDesktop(on)} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="notify-sound">Sound</Label>
        <Switch id="notify-sound" checked={prefs.sound} onCheckedChange={(on) => update({ ...prefs, sound: on })} />
      </div>
      {blocked && <p className="text-xs text-destructive">The browser blocks notifications for this site. Allow them in its site settings.</p>}
      <p className="text-xs text-muted-foreground">This tab checks every 15 seconds while it is open.</p>
      <Button type="button" size="sm" variant="outline" onClick={test}>
        Send a test notification
      </Button>
    </div>
  );
}

/**
 * The header bell. It polls what needs a person, notifies each new item once (desktop notification
 * and a ping, as chosen in its settings), and keeps the count in the tab title.
 */
export function AttentionNotifier({ load = fetchAttention, intervalMs = 15_000 }: { load?: () => Promise<AttentionItem[]>; intervalMs?: number }) {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    let seen = readSeen();
    const tick = async () => {
      let next: AttentionItem[];
      try {
        next = await load();
      } catch {
        return;
      }
      if (cancelled) return;
      // Nothing is notified the first time this browser looks, only what appears after that.
      const fresh = seen ? next.filter((item) => !seen!.has(item.id)) : [];
      if (fresh.length) notify(fresh);
      seen = new Set(next.map((item) => item.id));
      writeSeen(next);
      setItems(next);
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load, intervalMs]);

  useEffect(() => {
    document.title = titleWithCount(document.title, items.length);
  }, [items.length, pathname]);

  const Icon = items.length ? BellRingIcon : BellIcon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={label(items.length)}>
          <Icon />
          {items.length > 0 && <Badge variant="destructive">{items.length}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs your attention.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="flex flex-col rounded-md px-2 py-1.5 hover:bg-muted">
                  <span className="text-sm font-medium">{item.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Separator />
        <Settings />
      </PopoverContent>
    </Popover>
  );
}
