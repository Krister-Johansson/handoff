"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { isTyping } from "@/lib/voice/is-typing";
import { useVoicePrefs } from "@/lib/voice/prefs";
import { languageName } from "@/lib/voice/recognition";
import { useVoiceSupport, type VoiceSupport } from "@/lib/voice/support";
import { useSpeechInput, type InputState, type ListenMode } from "@/lib/voice/use-speech-input";

/** What voice needs from the speaker (speech synthesis comes in a later step). */
export type SpeakerLike = { isSpeaking(): boolean };

export type VoiceContextValue = {
  /** Whether listening is offered at all: recognition exists and can run on the device or is allowed on the server. */
  supported: boolean;
  state: InputState;
  mode: ListenMode;
  interim: string;
  error: string | undefined;
  /** The last final transcript. */
  heard: { text: string; at: number } | undefined;
  languageName: string;
  start(): Promise<void>;
  stop(): void;
  abort(): void;
  toggle(): void;
  install(): Promise<void>;
};

const VoiceContext = createContext<VoiceContextValue | undefined>(undefined);

export function useVoice(): VoiceContextValue {
  const voice = useContext(VoiceContext);
  if (!voice) throw new Error("useVoice needs a VoiceProvider.");
  return voice;
}

const NOT_SPEAKING: SpeakerLike = { isSpeaking: () => false };

/**
 * Voice for the whole dashboard: support, preferences and one listening session. Push to talk: the
 * header button or V starts it, and it never starts while the dashboard is speaking. A session
 * started from a text field dictates; one started elsewhere hears one command.
 */
export function VoiceProvider({ children, support: given, speaker = NOT_SPEAKING }: { children: ReactNode; support?: VoiceSupport; speaker?: SpeakerLike }) {
  const browser = useVoiceSupport();
  const support = given ?? browser;
  const prefs = useVoicePrefs();
  const [heard, setHeard] = useState<{ text: string; at: number }>();
  const onFinal = useCallback((text: string) => setHeard({ text, at: Date.now() }), []);
  const input = useSpeechInput({ ctor: support.recognition, lang: prefs.lang, allowServer: prefs.allowServerRecognition, onFinal });
  const supported = Boolean(support.recognition) && (support.onDeviceCheck || prefs.allowServerRecognition);
  const { start: startInput, stop, abort, install, state } = input;

  const start = useCallback(async () => {
    // Never listen while speaking: the microphone would hear the dashboard.
    if (!supported || speaker.isSpeaking()) return;
    await startInput(isTyping(document.activeElement) ? "dictation" : "command");
  }, [speaker, startInput, supported]);
  const toggle = useCallback(() => {
    if (state === "listening" || state === "starting") stop();
    else void start();
  }, [start, state, stop]);

  const value = useMemo<VoiceContextValue>(
    () => ({
      supported,
      state,
      mode: input.mode,
      interim: input.interim,
      error: input.error,
      heard,
      languageName: languageName(prefs.lang),
      start,
      stop,
      abort,
      toggle,
      install,
    }),
    [supported, state, input.mode, input.interim, input.error, heard, prefs.lang, start, stop, abort, toggle, install],
  );
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
