"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { isTyping } from "@/lib/voice/is-typing";
import { readVoicePrefs, useVoicePrefs } from "@/lib/voice/prefs";
import { languageName } from "@/lib/voice/recognition";
import { createSpeaker, type Speaker, type SpeakerState, type SpeechPriority } from "@/lib/voice/speaker";
import { useVoiceSupport, type VoiceSupport } from "@/lib/voice/support";
import { useSpeechInput, type InputState, type ListenMode } from "@/lib/voice/use-speech-input";

/** Content a page offers to read aloud: its run summary, plan or review, or acceptance criteria. */
export type Readable = { title: string; text: string };

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
  /** Whether this browser can speak. */
  canSpeak: boolean;
  speech: SpeakerState;
  /** Speaks text; listening stops first, so the microphone never hears the dashboard. */
  speak(text: string, options: { priority: SpeechPriority; title?: string }): void;
  stopSpeaking(): void;
  /** What the open page offers to read aloud, registered by useReadAloud. */
  readable: Readable | undefined;
  registerReadable(content: Readable): () => void;
};

const VoiceContext = createContext<VoiceContextValue | undefined>(undefined);

export function useVoice(): VoiceContextValue {
  const voice = useContext(VoiceContext);
  if (!voice) throw new Error("useVoice needs a VoiceProvider.");
  return voice;
}

const SILENT: SpeakerState = { speaking: false, sentence: 0, total: 0 };
const noSubscribe = () => () => {};

/**
 * Voice for the whole dashboard: support, preferences and one listening session. Push to talk: the
 * header button or V starts it, and it never starts while the dashboard is speaking. A session
 * started from a text field dictates; one started elsewhere hears one command.
 */
export function VoiceProvider({ children, support: given, speaker: givenSpeaker }: { children: ReactNode; support?: VoiceSupport; speaker?: Speaker }) {
  const browser = useVoiceSupport();
  const support = given ?? browser;
  const speaker = useMemo(() => givenSpeaker ?? (support.synth ? createSpeaker(support.synth, readVoicePrefs) : undefined), [givenSpeaker, support.synth]);
  const speech = useSyncExternalStore(speaker?.subscribe ?? noSubscribe, speaker?.getState ?? (() => SILENT), () => SILENT);
  const [readable, setReadable] = useState<Readable>();
  const prefs = useVoicePrefs();
  const [heard, setHeard] = useState<{ text: string; at: number }>();
  const onFinal = useCallback((text: string) => setHeard({ text, at: Date.now() }), []);
  const input = useSpeechInput({ ctor: support.recognition, lang: prefs.lang, allowServer: prefs.allowServerRecognition, onFinal });
  const supported = Boolean(support.recognition) && (support.onDeviceCheck || prefs.allowServerRecognition);
  const { start: startInput, stop, abort, install, state } = input;

  const start = useCallback(async () => {
    // Never listen while speaking: the microphone would hear the dashboard.
    if (!supported || speaker?.isSpeaking()) return;
    await startInput(isTyping(document.activeElement) ? "dictation" : "command");
  }, [speaker, startInput, supported]);
  const toggle = useCallback(() => {
    if (state === "listening" || state === "starting") stop();
    else void start();
  }, [start, state, stop]);

  const speak = useCallback(
    (text: string, options: { priority: SpeechPriority; title?: string }) => {
      if (!speaker) return;
      abort();
      speaker.speak(text, options);
    },
    [abort, speaker],
  );
  const stopSpeaking = useCallback(() => speaker?.stop(), [speaker]);
  const registerReadable = useCallback((content: Readable) => {
    setReadable(content);
    return () => setReadable((shown) => (shown === content ? undefined : shown));
  }, []);

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
      canSpeak: Boolean(speaker),
      speech,
      speak,
      stopSpeaking,
      readable,
      registerReadable,
    }),
    [supported, state, input.mode, input.interim, input.error, heard, prefs.lang, start, stop, abort, toggle, install, speaker, speech, speak, stopSpeaking, readable, registerReadable],
  );
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
