import { readPrefs } from "@/lib/attention";
import type { NotificationTone } from "@/lib/notifications";
import { playPing } from "@/lib/ping";
import { readVoicePrefs } from "@/lib/voice/prefs";

export const hasNotifications = () => typeof Notification !== "undefined";

/** Something new to tell the person about. Only an item with a tone can be spoken, and only one with a link opens a page. */
export type NotifyItem = { id: string; tone?: NotificationTone; title: string; body: string; href: string | null };

type SpeakNotification = (text: string) => void;
let speakNotification: SpeakNotification | undefined;

/**
 * How notifications are spoken in this page: the voice provider registers its speaker while it can
 * speak. Returns the function that takes it away again.
 */
export function setNotificationVoice(speak: SpeakNotification): () => void {
  speakNotification = speak;
  return () => {
    if (speakNotification === speak) speakNotification = undefined;
  };
}

/** What waits for the person or went wrong is spoken; what went well only when asked for; plain news never. */
const NEEDS_PERSON = new Set<NotificationTone>(["attention", "danger"]);

const SPOKEN_KEY = "handoff.voice.spoken";
const SPOKEN_KEEP = 100;

/**
 * Claims an item for speaking in this browser. Every open tab of the dashboard polls the same feed,
 * so the first tab to claim an item speaks it and the others stay quiet.
 */
function claim(id: string): boolean {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SPOKEN_KEY) ?? "[]");
    const spoken = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    if (spoken.includes(id)) return false;
    localStorage.setItem(SPOKEN_KEY, JSON.stringify([...spoken, id].slice(-SPOKEN_KEEP)));
  } catch {
    // Storage blocked: this tab speaks what it sees.
  }
  return true;
}

/** "{title}. {body}", with no doubled full stop. */
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
const spokenText = (item: NotifyItem) => [item.title.trim(), item.body.trim()].filter(Boolean).map(sentence).join(" ");

function speak(items: NotifyItem[]) {
  if (!speakNotification) return;
  const prefs = readVoicePrefs();
  if (!prefs.speakNotifications) return;
  for (const item of items) {
    if (!item.tone || !(NEEDS_PERSON.has(item.tone) || (prefs.speakFinished && item.tone === "success"))) continue;
    if (claim(item.id)) speakNotification(spokenText(item));
  }
}

/**
 * Tells the person about new items, the ways they chose in settings: a ping, desktop notifications,
 * and, with Speak notifications on, the item read aloud.
 */
export function notify(items: NotifyItem[]) {
  const prefs = readPrefs();
  if (prefs.sound) playPing();
  speak(items);
  if (!prefs.desktop || !hasNotifications() || Notification.permission !== "granted") return;
  for (const item of items) {
    const notification = new Notification(item.title, { body: item.body, tag: item.id });
    const { href } = item;
    notification.onclick = () => {
      window.focus();
      if (href) window.location.assign(href);
    };
  }
}
