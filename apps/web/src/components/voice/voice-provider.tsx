"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useOptionalAssistant, useOptionalAssistantPanel } from "@/components/assistant/assistant-provider";
import { setNotificationVoice } from "@/lib/notify";
import { approvalAnswer } from "@/lib/voice/approval-answer";
import { isTyping } from "@/lib/voice/is-typing";
import { readVoicePrefs, useVoicePrefs } from "@/lib/voice/prefs";
import { languageName } from "@/lib/voice/recognition";
import { dictationField, insertDictation, pagePhrases } from "@/lib/voice/dictation";
import { elevenLabsPlayer } from "@/lib/voice/elevenlabs-player";
import { createSpeaker, spokenReply, type Speaker, type SpeakerState, type SpeechPriority } from "@/lib/voice/speaker";
import { useVoiceSupport, type VoiceSupport } from "@/lib/voice/support";
import { useSpeechInput, type InputState, type ListenMode } from "@/lib/voice/use-speech-input";

/**
 * The voice bubble: a question said with V goes to the assistant, and its reply comes back here.
 * `since` is where the question's messages start in the conversation; `approval` is a card waiting
 * for a spoken yes or no.
 */
export type Bubble = {
  open: boolean;
  question?: string;
  since?: number;
  notice?: string;
  approval?: { requestId: string };
  /** What was heard when it was neither yes nor no. */
  misheard?: string;
  /** A card answered by voice, and the words that answered it. */
  answered?: { requestId: string; said: string };
};

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
  bubble: Bubble;
  closeBubble(): void;
};

const VoiceContext = createContext<VoiceContextValue | undefined>(undefined);

/** Voice where there may be none, as the assistant's composer uses it. */
export function useOptionalVoice(): VoiceContextValue | undefined {
  return useContext(VoiceContext);
}

export function useVoice(): VoiceContextValue {
  const voice = useContext(VoiceContext);
  if (!voice) throw new Error("useVoice needs a VoiceProvider.");
  return voice;
}

const SILENT: SpeakerState = { speaking: false, sentence: 0, total: 0 };
const CLOSED: Bubble = { open: false };
const noSubscribe = () => () => {};

/**
 * Voice for the whole dashboard: support, preferences and one listening session. Push to talk: the
 * header button or V starts it, and it never starts while the dashboard is speaking. A session
 * started from a text field dictates; one started elsewhere hears one command.
 */
export function VoiceProvider({
  children,
  support: given,
  speaker: givenSpeaker,
  speechAvailable = false,
}: {
  children: ReactNode;
  support?: VoiceSupport;
  speaker?: Speaker;
  /** Whether the dashboard can speak: it has an ElevenLabs key. */
  speechAvailable?: boolean;
}) {
  const browser = useVoiceSupport();
  const support = given ?? browser;
  const speaker = useMemo(() => givenSpeaker ?? (speechAvailable ? createSpeaker(elevenLabsPlayer(), readVoicePrefs) : undefined), [givenSpeaker, speechAvailable]);
  const speech = useSyncExternalStore(speaker?.subscribe ?? noSubscribe, speaker?.getState ?? (() => SILENT), () => SILENT);
  const [readable, setReadable] = useState<Readable>();
  const prefs = useVoicePrefs();
  const [heard, setHeard] = useState<{ text: string; at: number }>();
  const assistant = useOptionalAssistant();
  const panel = useOptionalAssistantPanel();
  const [shownBubble, setBubble] = useState<Bubble>(CLOSED);
  // A card answered with its buttons no longer waits for a spoken answer.
  const waitingId = shownBubble.approval?.requestId;
  const stillOpen = Boolean(
    waitingId && panel?.messages.some((m) => m.role === "assistant" && m.requests.some((r) => r.requestId === waitingId && r.status === "open")),
  );
  const bubble = useMemo<Bubble>(() => (waitingId && !stillOpen ? { ...shownBubble, approval: undefined } : shownBubble), [shownBubble, stillOpen, waitingId]);
  const latest = useRef({ assistant, panel, bubble, speaker });
  useEffect(() => {
    latest.current = { assistant, panel, bubble, speaker };
  });

  const say = useCallback((text: string) => latest.current.speaker?.speak(text, { priority: "reply" }), []);
  const onFinal = useCallback(
    (text: string, listenMode: ListenMode) => {
      if (listenMode === "dictation") {
        // Final words go into the focused text field at its caret; interim words stay in the strip.
        const field = dictationField(document.activeElement);
        if (field) insertDictation(field, text);
        return setHeard({ text, at: Date.now() });
      }
      const { assistant: port, panel: conversation, bubble: shown } = latest.current;
      if (shown.approval && port) {
        const answer = approvalAnswer(text);
        if (!answer) {
          setBubble((b) => ({ ...b, misheard: text }));
          return say("Say yes or no, or use the buttons.");
        }
        const requestId = shown.approval.requestId;
        setBubble((b) => ({ ...b, approval: undefined, misheard: undefined, answered: { requestId, said: text } }));
        return void port.respond(shown.approval.requestId, answer.approve ? { approve: true } : { approve: false, ...(answer.note ? { note: answer.note } : {}) });
      }
      if (!port?.available) return setBubble({ open: true, question: text, notice: "The assistant is off." });
      setBubble({ open: true, question: text, since: conversation?.messages.length ?? 0 });
      void port.send(text, { source: "voice" });
    },
    [say],
  );
  const input = useSpeechInput({ ctor: support.recognition, lang: prefs.lang, allowServer: prefs.allowServerRecognition, onFinal, phrases: pagePhrases });
  const supported = Boolean(support.recognition) && (support.onDeviceCheck || prefs.allowServerRecognition);
  const { start: startInput, stop, abort, install, state } = input;

  // Speech nobody asked for just now (a notification, a reply in the panel) waits while the microphone
  // is open, so the dashboard never talks over the person, and is said once listening ends.
  const micOpen = state === "listening" || state === "starting";
  const quiet = useRef({ micOpen, waiting: [] as { text: string; priority: SpeechPriority }[] });
  const sayWhenQuiet = useCallback((text: string, priority: SpeechPriority) => {
    if (quiet.current.micOpen) quiet.current.waiting.push({ text, priority });
    else latest.current.speaker?.speak(text, { priority });
  }, []);
  useEffect(() => {
    quiet.current.micOpen = micOpen;
    if (micOpen || !quiet.current.waiting.length) return;
    const due = quiet.current.waiting;
    quiet.current.waiting = [];
    for (const { text, priority } of due) speaker?.speak(text, { priority });
  }, [micOpen, speaker]);
  // New notifications are spoken here while the dashboard can speak; notify() decides which.
  useEffect(() => {
    if (!speaker) return;
    return setNotificationVoice((text) => sayWhenQuiet(text, "notification"));
  }, [speaker, sayWhenQuiet]);

  const start = useCallback(async () => {
    if (!supported) return;
    // Never listen while speaking: asking to listen stops the speech first, so the microphone never hears the dashboard.
    if (speaker?.isSpeaking()) speaker.stop();
    const listenMode = isTyping(document.activeElement) ? "dictation" : "command";
    // A question is asked in the bubble; dictation stays in its text field. A new question replaces the
    // last one, unless an approval card waits for its spoken answer.
    if (listenMode === "command") setBubble((b) => (b.approval ? { ...b, open: true, notice: undefined } : { open: true }));
    await startInput(listenMode);
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
  // The bubble's question gets its reply spoken, and an approval is read out with how to answer it.
  const onReply = assistant?.onReply;
  const onRequest = assistant?.onRequest;
  useEffect(() => {
    if (!onReply || !onRequest) return;
    const offReply = onReply((reply) => {
      const shown = latest.current.bubble;
      // A streaming reply is spoken only when it is done; its text stays on screen.
      if (!reply.done || !reply.text) return;
      if (shown.open && shown.question) say(spokenReply(reply.text));
      else if (readVoicePrefs().speakReplies) sayWhenQuiet(spokenReply(reply.text), "reply");
    });
    const offRequest = onRequest((request) => {
      if (!latest.current.bubble.open) return;
      setBubble((b) => ({ ...b, approval: { requestId: request.requestId }, misheard: undefined }));
      say(`${request.title}: ${request.summary}. Say yes or no.`);
      // Once the card is read out, listen once for the answer; V listens again after that.
      const listen = () => {
        const shown = latest.current.bubble;
        if (shown.open && shown.approval?.requestId === request.requestId) void startInput("command");
      };
      const speaking = latest.current.speaker;
      if (!speaking?.isSpeaking()) return listen();
      const off = speaking.subscribe(() => {
        if (speaking.isSpeaking()) return;
        off();
        listen();
      });
    });
    return () => {
      offReply();
      offRequest();
    };
  }, [onReply, onRequest, say, sayWhenQuiet, startInput]);

  const closeBubble = useCallback(() => {
    abort();
    speaker?.stop();
    setBubble(CLOSED);
  }, [abort, speaker]);

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
      bubble,
      closeBubble,
    }),
    [supported, state, input.mode, input.interim, input.error, heard, prefs.lang, start, stop, abort, toggle, install, speaker, speech, speak, stopSpeaking, readable, registerReadable, bubble, closeBubble],
  );
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
