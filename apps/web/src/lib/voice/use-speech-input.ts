"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { voiceErrorMessage } from "./errors";
import { checkOnDevice, createRecognizer, installOnDevice, languageName, onRecognizer, type Recognizer } from "./recognition";
import type { RecognitionCtor } from "./support";

/** Command mode hears one utterance; dictation mode keeps listening until stopped. */
export type ListenMode = "command" | "dictation";
export type InputState = "idle" | "starting" | "listening" | "blocked" | "downloadable" | "downloading" | "unavailable";

export type SpeechInputOptions = {
  ctor: RecognitionCtor | undefined;
  lang: string;
  /** Whether audio may go to the browser vendor's recognition service when there is no on-device pack. */
  allowServer: boolean;
  onFinal(text: string, mode: ListenMode): void;
};

const BLOCKING = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);

type ResultEvent = Event & { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };

/**
 * Listening through the Web Speech API, on the device unless server recognition is allowed. Interim
 * text is exposed as it comes; each final result goes to onFinal once. abort() discards whatever
 * arrives after it. In dictation mode Chrome's own end of a session restarts it until stop().
 */
export function useSpeechInput(options: SpeechInputOptions) {
  const [state, setState] = useState<InputState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<ListenMode>("command");
  const current = useRef<{ recognizer: Recognizer; mode: ListenMode; listening: boolean; discarded: boolean; blocked: boolean; listeners: AbortController }>(undefined);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  // Leaving the page stops listening and drops the recognizer's listeners.
  useEffect(
    () => () => {
      current.current?.listeners.abort();
      current.current?.recognizer.abort();
    },
    [],
  );

  const listen = useCallback((ctor: RecognitionCtor, listenMode: ListenMode, processLocally: boolean) => {
    const recognizer = createRecognizer(ctor, { lang: latest.current.lang, continuous: listenMode === "dictation", processLocally });
    const listeners = new AbortController();
    const session = { recognizer, mode: listenMode, listening: true, discarded: false, blocked: false, listeners };
    current.current = session;
    onRecognizer(
      recognizer,
      {
        start: () => !session.discarded && setState("listening"),
        result: (event) => {
          if (session.discarded) return;
          const { resultIndex, results } = event as ResultEvent;
          let pending = "";
          for (let i = resultIndex; i < results.length; i++) {
            const result = results[i]!;
            const text = result[0]?.transcript.trim() ?? "";
            if (result.isFinal) {
              if (text) latest.current.onFinal(text, session.mode);
            } else pending += `${pending ? " " : ""}${text}`;
          }
          setInterim(pending);
        },
        error: (code) => {
          if (session.discarded || code === "aborted") return;
          if (BLOCKING.has(code)) {
            session.blocked = true;
            session.listening = false;
          }
          setError(voiceErrorMessage(code));
        },
        end: () => {
          if (current.current !== session || session.discarded) return;
          if (session.mode === "dictation" && session.listening && !session.blocked) {
            // Chrome ended the session after a pause; dictation goes on until the person stops it.
            recognizer.start();
            return;
          }
          current.current = undefined;
          listeners.abort();
          setInterim("");
          setState(session.blocked ? "blocked" : "idle");
        },
      },
      listeners.signal,
    );
    setMode(listenMode);
    recognizer.start();
  }, []);

  const start = useCallback(
    async (listenMode: ListenMode) => {
      const { ctor, lang, allowServer } = latest.current;
      if (!ctor || current.current) return;
      setError(undefined);
      setState("starting");
      const onDevice = await checkOnDevice(ctor, lang);
      if (onDevice === "available") return listen(ctor, listenMode, true);
      if (allowServer) return listen(ctor, listenMode, false);
      setMode(listenMode);
      if (onDevice === "downloadable" || onDevice === "downloading") return setState(onDevice);
      setError(
        onDevice === "unknown"
          ? "This browser cannot check for on-device recognition. Turn on server-based recognition in Settings, Voice to listen."
          : `${languageName(lang)} has no on-device speech pack in this browser. Turn on server-based recognition in Settings, Voice to listen anyway.`,
      );
      setState("unavailable");
    },
    [listen],
  );

  const stop = useCallback(() => {
    const session = current.current;
    if (!session) return setState((s) => (s === "listening" || s === "starting" ? s : "idle"));
    session.listening = false;
    session.recognizer.stop();
  }, []);

  const abort = useCallback(() => {
    const session = current.current;
    current.current = undefined;
    if (session) {
      session.discarded = true;
      session.listening = false;
      session.recognizer.abort();
    }
    setInterim("");
    setState("idle");
  }, []);

  /** Installs the language's on-device pack from a click, then starts listening. */
  const install = useCallback(async () => {
    const { ctor, lang } = latest.current;
    if (!ctor) return;
    setState("downloading");
    if (await installOnDevice(ctor, lang)) return start(mode);
    setError(`${languageName(lang)} could not be installed for offline use.`);
    setState("unavailable");
  }, [mode, start]);

  return { state, interim, error, mode, start, stop, abort, install };
}
