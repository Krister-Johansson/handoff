"use client";

import { useEffect, useEffectEvent } from "react";
import { isTyping } from "@/lib/voice/is-typing";
import { useVoice } from "./voice-provider";

/**
 * V toggles listening outside text fields; Escape stops speaking, else stops listening and drops what
 * was half heard, else closes the voice bubble. When voice is idle Escape is left to dialogs.
 */
export function VoiceHotkeys() {
  const voice = useVoice();
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.repeat) return;
    // Escape stops speech first; a second Escape stops listening.
    if (e.key === "Escape" && voice.speech.speaking) {
      voice.stopSpeaking();
      return;
    }
    if (e.key === "Escape" && (voice.state === "listening" || voice.state === "starting")) {
      voice.abort();
      return;
    }
    if (e.key === "Escape" && voice.bubble.open) {
      voice.closeBubble();
      return;
    }
    if (!voice.supported) return;
    if (e.code === "KeyM" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      voice.toggle();
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
