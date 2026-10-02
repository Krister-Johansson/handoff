"use client";

import { DownloadIcon, MicIcon, MicOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVoice } from "./voice-provider";

/**
 * The header's microphone: Listen and Stop listening, or the offer to install the language for
 * offline use. Clicking it keeps focus where it was, so listening from a text field dictates into it.
 */
export function VoiceButton() {
  const voice = useVoice();
  if (!voice.supported) return null;
  const active = voice.state === "listening" || voice.state === "starting";
  if (voice.state === "downloadable") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="relative text-attention after:absolute after:-inset-1.5"
        aria-label={`Install ${voice.languageName} for offline use`}
        title={`Install ${voice.languageName} for offline use`}
        onClick={() => void voice.install()}
      >
        <DownloadIcon />
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      // A 44 px target around the header-sized icon; while listening it fills and a ring pulses out.
      className={cn(
        "relative rounded-full text-muted-foreground after:absolute after:-inset-1.5 after:rounded-full",
        active &&
          "bg-primary text-primary-foreground before:absolute before:inset-0 before:-z-10 before:rounded-full before:bg-primary/35 before:motion-safe:animate-ping hover:bg-primary/90 hover:text-primary-foreground",
      )}
      aria-label={active ? "Stop listening" : "Listen"}
      aria-pressed={active}
      title={active ? "Stop listening (Ctrl+M or Escape)" : "Listen (Ctrl+M)"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={voice.toggle}
    >
      {voice.state === "blocked" ? <MicOffIcon /> : <MicIcon />}
    </Button>
  );
}
