"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { readPrefs, writePrefs, type NotifyPrefs } from "@/lib/attention";
import { hasNotifications, notify } from "@/lib/notify";

/** How this browser tells you that a run needs you. The choices are stored in this browser only. */
export function NotificationSettings() {
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
  const test = () =>
    notify([{ id: `test:${Date.now()}`, title: "handoff notifications work", body: "You will see one like this when a run needs you.", href: window.location.pathname }]);
  return (
    <div className="flex max-w-md flex-col gap-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="notify-desktop">Desktop notifications</Label>
          <span className="text-xs text-muted-foreground">A notification for each new question, failed run or PR waiting for review. Clicking it opens the run.</span>
        </div>
        <Switch id="notify-desktop" checked={prefs.desktop} disabled={!hasNotifications()} onCheckedChange={(on) => void setDesktop(on)} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="notify-sound">Sound</Label>
          <span className="text-xs text-muted-foreground">A short ping with each new item.</span>
        </div>
        <Switch id="notify-sound" checked={prefs.sound} onCheckedChange={(on) => update({ ...prefs, sound: on })} />
      </div>
      {blocked && <p className="text-xs text-destructive">The browser blocks notifications for this site. Allow them in its site settings.</p>}
      <p className="text-xs text-muted-foreground">An open dashboard tab checks every 15 seconds. These choices are kept in this browser.</p>
      <div>
        <Button type="button" size="sm" variant="outline" onClick={test}>
          Send a test notification
        </Button>
      </div>
    </div>
  );
}
