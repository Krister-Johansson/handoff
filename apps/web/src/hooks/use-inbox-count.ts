"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export const fetchInboxCount = async (): Promise<number> => {
  const res = await fetch("/api/inbox/count", { cache: "no-store" });
  if (!res.ok) throw new Error(`inbox count: ${res.status}`);
  return ((await res.json()) as { count: number }).count;
};

/**
 * The Inbox count for the sidebar's badge. The layout renders `rendered` on a full load and again when
 * a server action revalidates it, but client navigation keeps the layout, and items are answered in
 * other tabs, over MCP and by the worker. So the count is also read on each navigation, when the window
 * gets focus, and every `intervalMs` while the tab is visible.
 */
export function useInboxCount(rendered: number, { load = fetchInboxCount, intervalMs = 15_000 }: { load?: () => Promise<number>; intervalMs?: number } = {}) {
  const pathname = usePathname();
  const [read, setRead] = useState<{ count: number; rendered: number }>();
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const count = await load();
        if (!cancelled) setRead({ count, rendered });
      } catch {
        // Keep what the badge shows; the next read may work.
      }
    };
    const onShow = () => void tick();
    onShow();
    const timer = setInterval(onShow, intervalMs);
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load, intervalMs, pathname, rendered]);
  // A count read since the layout last rendered is newer than that render; a new render is newer still.
  return read && read.rendered === rendered ? read.count : rendered;
}
