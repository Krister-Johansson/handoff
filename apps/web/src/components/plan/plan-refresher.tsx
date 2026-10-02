"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How often the page reads GitHub again while it is visible; Project changes on a user account have no webhook. */
const INTERVAL_MS = 30_000;

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const isVisible = () => document.visibilityState === "visible";

function ago(seconds: number) {
  return seconds < 60 ? `${seconds} s ago` : `${Math.floor(seconds / 60)} min ago`;
}

/**
 * The muted line under the plan, "Updated 12 s ago from GitHub" with a refresh button, and the poll
 * behind it: router.refresh every 30 seconds while the tab is visible, none while it is hidden.
 */
export function PlanRefresher({ readAt }: { readAt: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(readAt);
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true);
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(refresh, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, refresh]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const seconds = Math.max(0, Math.round((now - readAt) / 1000));
  return (
    <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      <span>{pending ? "Updating from GitHub" : `Updated ${ago(seconds)} from GitHub`}</span>
      <Button size="icon-xs" variant="ghost" aria-label="Refresh from GitHub" disabled={pending} onClick={refresh}>
        <RefreshCwIcon className={cn(pending && "animate-spin")} />
      </Button>
    </div>
  );
}
