import { afterEach, expect, test } from "vitest";
import { DEFAULT_VOICE_PREFS, readVoicePrefs, VOICE_PREFS_KEY, writeVoicePrefs } from "./prefs";

afterEach(() => localStorage.clear());

test("readVoicePrefs returns defaults with speaking off and server recognition off when nothing is stored", () => {
  expect(readVoicePrefs()).toEqual({
    lang: "en-US",
    allowServerRecognition: false,
    speakReplies: false,
    speakNotifications: false,
    speakFinished: false,
    voiceURI: null,
    rate: 1,
    allowRemoteVoices: false,
  });
  expect(readVoicePrefs()).toEqual(DEFAULT_VOICE_PREFS);
});

test("writeVoicePrefs round-trips through localStorage and readVoicePrefs tolerates garbage", () => {
  writeVoicePrefs({ ...DEFAULT_VOICE_PREFS, lang: "sv-SE", speakReplies: true, rate: 1.25, voiceURI: "Alva" });
  expect(readVoicePrefs()).toMatchObject({ lang: "sv-SE", speakReplies: true, rate: 1.25, voiceURI: "Alva", allowServerRecognition: false });

  localStorage.setItem(VOICE_PREFS_KEY, "{not json");
  expect(readVoicePrefs()).toEqual(DEFAULT_VOICE_PREFS);
  // Wrong types fall back field by field; a rate outside the setting's range, 0.5 to 2, is clamped.
  localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ lang: 42, speakReplies: "yes", rate: 99, allowServerRecognition: true }));
  expect(readVoicePrefs()).toEqual({ ...DEFAULT_VOICE_PREFS, rate: 2, allowServerRecognition: true });
});
