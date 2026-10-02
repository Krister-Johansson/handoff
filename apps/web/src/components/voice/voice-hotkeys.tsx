"use client";

import { useEffect, useEffectEvent } from "react";
import { isTyping } from "@/lib/voice/is-typing";
import { useVoice } from "./voice-provider";

/**
 * V toggles listening outside text fields; Escape stops listening and drops what was half heard.
 * When voice is idle Escape is left to whatever else uses it, such as dialogs.
 */
export function VoiceHotkeys() {
  const voice = useVoice();
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!voice.supported || e.repeat) return;
    if (e.key === "Escape" && (voice.state === "listening" || voice.state === "starting")) {
      voice.abort();
      return;
    }
    if (e.key.toLowerCase() === "v" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
      e.preventDefault();
      voice.toggle();
    }
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  return null;
}
