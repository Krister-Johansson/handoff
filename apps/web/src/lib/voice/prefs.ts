/** How this browser listens and speaks. Kept in localStorage; audio stays on the machine unless a switch says otherwise. */
export type VoicePrefs = {
  /** The recognition language, also used to pick a voice. */
  lang: string;
  /** Allow Chrome's server-based recognition, which sends audio to Google, when no on-device pack exists. */
  allowServerRecognition: boolean;
  speakReplies: boolean;
  speakNotifications: boolean;
  /** Also speak finished and merged runs, not only what needs the person. */
  speakFinished: boolean;
  voiceURI: string | null;
  rate: number;
  /** Allow voices that synthesize on a remote service. */
  allowRemoteVoices: boolean;
};

export const VOICE_PREFS_KEY = "handoff.voice";

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  lang: "en-US",
  allowServerRecognition: false,
  speakReplies: false,
  speakNotifications: false,
  speakFinished: false,
  voiceURI: null,
  rate: 1,
  allowRemoteVoices: false,
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
    voiceURI: typeof raw.voiceURI === "string" ? raw.voiceURI : d.voiceURI,
    rate: typeof raw.rate === "number" && Number.isFinite(raw.rate) ? Math.min(MAX_RATE, Math.max(MIN_RATE, raw.rate)) : d.rate,
    allowRemoteVoices: bool(raw.allowRemoteVoices, d.allowRemoteVoices),
  };
}

export function writeVoicePrefs(prefs: VoicePrefs) {
  try {
    localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked; the setting lasts for this page only.
  }
}
