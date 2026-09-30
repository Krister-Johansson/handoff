import { readPrefs, type AttentionItem } from "@/lib/attention";
import { playPing } from "@/lib/ping";

export const hasNotifications = () => typeof Notification !== "undefined";

/** Tells the person about new items, the ways they chose on the settings page: a ping, desktop notifications or both. */
export function notify(items: AttentionItem[]) {
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
