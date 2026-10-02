import { useSyncExternalStore } from "react";

/** How this browser listens and speaks. Kept in localStorage; audio stays on the machine unless a switch says otherwise. */
export type VoicePrefs = {
  /** The language spoken to the dashboard. */
  lang: string;
  /** Allow Chrome's server-based recognition, which sends audio to Google, when no on-device pack exists. */
  allowServerRecognition: boolean;
  speakReplies: boolean;
  speakNotifications: boolean;
  /** Also speak finished and merged runs, not only what needs the person. */
  speakFinished: boolean;
  rate: number;
  /** The ElevenLabs voice; none means the dashboard's default voice. */
  elevenLabsVoiceId: string | null;
};

export const VOICE_PREFS_KEY = "handoff.voice";

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  lang: "en-US",
  allowServerRecognition: false,
  speakReplies: false,
  speakNotifications: false,
  speakFinished: false,
  rate: 1,
  elevenLabsVoiceId: null,
};

export const MIN_RATE = 0.5;
export const MAX_RATE = 2;

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** The stored preferences, field by field: anything missing or of the wrong type takes its default. */
export function readVoicePrefs(): VoicePrefs {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    // Garbage or blocked storage: the defaults.
  }
  const d = DEFAULT_VOICE_PREFS;
  return {
    lang: typeof raw.lang === "string" && raw.lang ? raw.lang : d.lang,
    allowServerRecognition: bool(raw.allowServerRecognition, d.allowServerRecognition),
    speakReplies: bool(raw.speakReplies, d.speakReplies),
    speakNotifications: bool(raw.speakNotifications, d.speakNotifications),
    speakFinished: bool(raw.speakFinished, d.speakFinished),
    rate: typeof raw.rate === "number" && Number.isFinite(raw.rate) ? Math.min(MAX_RATE, Math.max(MIN_RATE, raw.rate)) : d.rate,
    elevenLabsVoiceId: typeof raw.elevenLabsVoiceId === "string" && raw.elevenLabsVoiceId ? raw.elevenLabsVoiceId : d.elevenLabsVoiceId,
  };
}

const CHANGED = "handoff:voice";

export function writeVoicePrefs(prefs: VoicePrefs) {
  try {
    localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked; the setting lasts for this page only.
  }
  window.dispatchEvent(new Event(CHANGED));
}

let cached: { raw: string | null; prefs: VoicePrefs } | undefined;
function snapshot(): VoicePrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(VOICE_PREFS_KEY);
  } catch {
    // Blocked storage reads as nothing stored.
  }
  if (!cached || cached.raw !== raw) cached = { raw, prefs: readVoicePrefs() };
  return cached.prefs;
}
function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The voice preferences, kept current when Settings changes them in this tab or another. */
export function useVoicePrefs(): VoicePrefs {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_VOICE_PREFS);
}
