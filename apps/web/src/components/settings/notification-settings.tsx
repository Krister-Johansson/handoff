"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { readPrefs, writePrefs, type NotifyPrefs } from "@/lib/attention";
import { hasNotifications, notify } from "@/lib/notify";

/** One setting as a row: its name and what it does on the left, the control on the right. */
function Setting({ id, title, description, children }: { id?: string; title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t py-3.5 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-0.5">
        {id ? <Label htmlFor={id}>{title}</Label> : <span className="font-medium">{title}</span>}
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {children}
    </div>
  );
}

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
    <div className="flex flex-col text-sm">
      <Setting id="notify-desktop" title="Desktop notifications" description="A notification for each new question, failed run or PR waiting for review. Clicking it opens the run.">
        <Switch id="notify-desktop" checked={prefs.desktop} disabled={!hasNotifications()} onCheckedChange={(on) => void setDesktop(on)} />
      </Setting>
      {blocked && <p className="pb-3 text-xs text-destructive">The browser blocks notifications for this site. Allow them in its site settings.</p>}
      <Setting id="notify-sound" title="Sound" description="A short ping with each new item.">
        <Switch id="notify-sound" checked={prefs.sound} onCheckedChange={(on) => update({ ...prefs, sound: on })} />
      </Setting>
      <Setting title="Test" description="You will see one like this when a run needs you.">
        <Button type="button" size="sm" variant="outline" onClick={test}>
          Send a test notification
        </Button>
      </Setting>
      <p className="pt-3 text-xs text-muted-foreground">An open dashboard tab checks every 15 seconds. These choices are kept in this browser.</p>
    </div>
  );
}
