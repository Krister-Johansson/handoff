"use client";

import { useEffect, useEffectEvent } from "react";
import { useOptionalAssistant } from "@/components/assistant/assistant-provider";
import { useVoice } from "./voice-provider";

/**
 * Control+M on every system, Control on a Mac too, so Cmd+M stays the system's minimize. Matched by
 * the physical key, so a keyboard layout that types something else on M still gets it.
 */
const isVoiceKey = (e: KeyboardEvent) => e.code === "KeyM" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

/**
 * Ctrl+M starts and stops listening, in a text field too: with the assistant panel open it dictates
 * into the panel's message box, otherwise the voice bubble listens for one question. Escape stops
 * speaking, else stops listening and drops what was half heard, else closes the voice bubble. When
 * voice is idle Escape is left to dialogs.
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
    if (!voice.supported || !isVoiceKey(e)) return;
    e.preventDefault();
    if (voice.state === "listening" || voice.state === "starting") return voice.stop();
    const composer = assistant?.isOpen ? assistant.composerRef.current : null;
    if (composer) {
      composer.focus();
      return void voice.start("dictation");
    }
    void voice.start("command");
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  return null;
}
