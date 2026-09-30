"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon, BellRingIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { readSeen, titleWithCount, writeSeen, type AttentionItem } from "@/lib/attention";
import { notify } from "@/lib/notify";

const fetchAttention = async (): Promise<AttentionItem[]> => {
  const res = await fetch("/api/attention", { cache: "no-store" });
  if (!res.ok) throw new Error(`attention: ${res.status}`);
  return ((await res.json()) as { items: AttentionItem[] }).items;
};

const label = (n: number) => (n === 0 ? "Nothing needs your attention" : `${n} ${n === 1 ? "thing needs" : "things need"} your attention`);

/**
 * The header bell. It polls what needs a person, notifies each new item once (desktop notification
 * and a ping, as chosen on the settings page), and keeps the count in the tab title.
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
        <Link href="/settings#notifications" className="text-xs text-muted-foreground hover:underline">
          Notification settings
        </Link>
      </PopoverContent>
    </Popover>
  );
}
