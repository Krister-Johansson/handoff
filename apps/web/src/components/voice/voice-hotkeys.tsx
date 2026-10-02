"use client";

import { useEffect, useEffectEvent } from "react";
import { useOptionalAssistant } from "@/components/assistant/assistant-provider";
import { useVoice } from "./voice-provider";

/**
 * V toggles listening outside text fields; Escape stops speaking, else stops listening and drops what
 * was half heard, else closes the voice bubble. When voice is idle Escape is left to dialogs.
 */
export function VoiceHotkeys() {
  const voice = useVoice();
  const assistant = useOptionalAssistant();
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
      if (voice.state === "listening" || voice.state === "starting") return voice.stop();
      // With the assistant panel open, the words go into its message box.
      const composer = assistant?.isOpen ? assistant.composerRef.current : null;
      if (composer) {
        composer.focus();
        return void voice.start("dictation");
      }
      return void voice.start("command");
    }
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  return null;
}
